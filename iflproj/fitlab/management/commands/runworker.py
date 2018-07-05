'''
Worker process which handles all ui requests in parallel.
'''
import time
import threading
import logging
import json
import re
import importlib
import sys
import os

from django.core.management.base import BaseCommand
from queue import Queue, Empty

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from fitlab.models import GraphUiRequest, GraphReply, GraphSession
import enginterface

NUM_THREADS = 4

class SoftGraphSession:
    def __init__(self, gs_id, username):
        '''
        gs_id : key, db key and unique obj identifier 
        username : associated user, can be used for logging and more
        '''
        self.gs_id = gs_id
        self.username = username 
        self.graph = None
        self.reset()

    def _loadNodeTypesJsFile(self):
        text = open('fitlab/static/fitlab/nodetypes.js').read()
        m = re.search("var nodeTypes\s=\s([^;]*)", text, re.DOTALL)
        return m.group(1)

    def update_and_execute(self, runid, syncset):
        json_obj = self.graph.graph_update(syncset)
        if json_obj:
            return json_obj
        json_obj = self.graph.execute_node(runid)
        return json_obj

    def reset(self):
        if (self.graph):
            self.graph.shutdown()

        text = self._loadNodeTypesJsFile()
        tree = enginterface.TreeJsonAddr(json.loads(text))

        text = open('pmodule.json').read()
        pmod = json.loads(text)
        mdl = importlib.import_module(pmod["module"], pmod["package"]) # rewrite fom package = dot ! 
        self.graph = enginterface.FlatGraph(tree, mdl)

    def test(self):
        cmds = json.loads('[[["node_add",454.25,401.3333333333333,"o0","","","obj"],["node_rm","o0"]],[["node_add",382.75,281.3333333333333,"o1","","","Pars"],["node_rm","o1"]],[["node_add",348,367.3333333333333,"f0","","C","Colour"],["node_rm","f0"]],[["link_add","o1",0,"f0",0,0],["link_rm","o1",0,"f0",0,0]],[["link_add","f0",0,"o0",0,0],["link_rm","f0",0,"o0",0,0]],[["node_data","o1","\\"red\\""],["node_data","o1",{}]]]')

        self.graph.graph_change(cmds)
        self.graph.execute_node("o0")


'''
Internal commands as functions
'''
def load(req): pass
def restore(req): pass
def attach(req): pass
def save(req): pass
def stash_shutdown(req): pass
def savecopy(req): pass
def update_run(req): pass
def shutdown(req): pass

def _session_is_live(req): pass
def _session_is_autosave(req): pass

'''
External commands blueprint

public/ui:
- attach/load-attach: this is the 'ifl/graph_session/id' url
- save: the save button, sets the restore point (this is quick-save)
- restore: revert to last save
- save-a-copy: inverted save-as, creates save data on a new session
- update_run: the bread-and-butter run button
- shutdown: logout or session timeout
'''

class Task:
    def __init__(self, username, gs_id, sync_obj_str, reqid, cmd):
        self.username = username
        self.gs_id = gs_id
        self.reqid = reqid
        self.sync_obj = json.loads(sync_obj_str)
        self.cmd = cmd

class Workers:
    '''
    Represents a pool of worker threads.
    '''
    def __init__(self, threaded=True):
        self.taskqueue = Queue()
        self.sessions = {}
        self.terminated = False
        self.threaded = threaded
        
        self.threads = []
        for i in range(NUM_THREADS):
            t = threading.Thread(target=self.threadwork)
            t.setDaemon(True)
            t.setName('%s (%s)' % (t.getName().replace('Thread-','T')))
            t.start()
            self.threads.append(t)

    def mainwork(self):
        ''' Process a batch of UIRequest objects. Called from the main thread. '''
        for uireq in GraphUiRequest.objects.all():
            self.taskqueue.put(Task(uireq.username, uireq.gs_id, uireq.syncset, uireq.id, uireq.cmd))
            uireq.delete()
        if not self.threaded:
            self.threadwork()

    def terminate(self):
        self.terminated = True
        # TODO: introduce a thread.wait at the end here

    def threadwork(self):
        '''  '''
        # check for the self.terminated=True signal every timeout seconds
        task = None
        while not self.terminated:
            try:
                task = self.taskqueue.get(block=True, timeout=0.1)
            except Empty:
                task = None
            if not task:
                # sigle run (debug mode, not threaded)
                if not self.threaded:
                    return
                continue

            logging.info("doing task, session id: %s" % task.gs_id)
            try:
                session = self.sessions.get(task.gs_id, None)
                if not session:
                    logging.info("no session found...")
                    try:
                        obj = GraphSession.objects.filter(id=task.gs_id)[0]
                    except:
                        raise Exception("requested gs_id yielded no soft graph session or db object")

                    logging.info("creating session, id: %s" % task.gs_id)
                    session = SoftGraphSession(task.gs_id, obj.username)
                    self.sessions[task.gs_id] = session

                # validate username
                if session.username != task.username:
                    raise Exception("username validation failed, sender: %s, session: %s" % (task.username, obj.username))

                if task.cmd == "load":
                    if not self.sessions.get(task.gs_id, None) is not None:
                        # create the session object
                        try:
                            obj = GraphSession.objects.filter(id=task.gs_id)[0]
                        except:
                            raise Exception("requested gs_id yielded no soft graph session or db object")
                        self.sessions[task.gs_id] = SoftGraphSession(task.gs_id, obj.username)

                        if not _session_is_autosave(task):
                            load(task)
                        else:
                            restore(task)
                    attach(task)

                elif task.cmd == "save":
                    save(task)

                elif task.cmd == "branch":
                    savecopy(task)

                elif task.cmd == "update_run":
                    json_obj = session.update_and_execute(task.sync_obj['run_id'], task.sync_obj['sync'])
                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps(json_obj))
                    graphreply.save()

                elif task.cmd == "save_shutdown":
                    save(task)
                    shutdown(task)

                elif task.cmd == "shutdown":
                    shutdown(task)

                else:
                    raise Exception("invalid command: %s" % task.cmd)

                # TODO: log
                logging.info("...")

            except Exception as e:
                # TODO: thread-log this
                logging.error(str(e))
                # save fail state / raise ?


class Command(BaseCommand):
    help = 'start this in a separate process, it is required for any work to be done'

    def add_arguments(self, parser):
        parser.add_argument('--debug', action='store_true', help="run work() only once using main thread")
        parser.add_argument('--singlethreaded', action='store_true', help="run work() using main thread only")

    def handle(self, *args, **options):
        logging.basicConfig(level=logging.INFO, format='%(threadName)-22s: %(message)s' )

        logging.info("looking for tasks...")
        workers = Workers(threaded=True)
        try:
            while True:
                workers.mainwork()
                time.sleep(0.1)

        # ctr-c exits
        except KeyboardInterrupt:
            print("")
            logging.info("shutdown requested, exiting...")
            workers.terminate()
            print("")
            print("")

