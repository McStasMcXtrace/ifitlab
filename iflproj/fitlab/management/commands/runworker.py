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
import pickle
import base64


from django.core.management.base import BaseCommand
from queue import Queue, Empty

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

from iflproj import settings
from fitlab.models import GraphUiRequest, GraphReply, GraphSession, GraphDef
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


def to_djangodb_str(obj):
    tosave = base64.b64encode(pickle.dumps(obj))
    return str(tosave)[2:]

def from_djangodb_str(s):
    b = bytes(s, 'utf8')
    toload = bytes(str(b)[2:], 'utf8')
    obj = pickle.loads(base64.b64decode(toload))
    return obj


class Task:
    def __init__(self, username, gs_id, sync_obj_str, reqid, cmd):
        self.username = username
        self.gs_id = gs_id
        self.reqid = reqid
        self.sync_obj = None
        if sync_obj_str:
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
            t.setName('%s' % (t.getName().replace('Thread-','T')))
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

                    logging.info("creating session, gs_id: %s" % task.gs_id)
                    session = SoftGraphSession(task.gs_id, obj.username)
                    self.sessions[task.gs_id] = session

                # validate username
                if session.username != task.username:
                    raise Exception("username validation failed, sender: %s, session: %s" % (task.username, obj.username))


                #########################
                #    execute command    #
                #########################


                # load/attach command
                if task.cmd == "load":
                    obj = GraphSession.objects.filter(id=task.gs_id)[0]

                    # load python structure
                    session.graph = from_djangodb_str(obj.quicksave_pickle)
                    
                    # load matlab variables
                    filepath = os.path.join(settings.MATFILES_DIRNAME, obj.quicksave_matfile)
                    load_fct = session.graph.get_load_fct()
                    load_fct(filepath)
                    
                    gd = session.graph.extract_graphdef()
                    update = session.graph.extract_update()
                    
                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps( { "graphdef" : gd, "update" : update} ))
                    graphreply.save()


                    # TODO: implement 'restore' when a live graph of that id already exists
                    '''
                    # how it perhaps will be: 
                    if not _session_is_autosave(task):
                        load(task)
                    else:
                        restore(task)
                    '''

                elif task.cmd == "save":
                    anyerrors = session.graph.graph_update(task.sync_obj)
                    if anyerrors:
                        raise Exception("errors encountered during sync")
                    
                    # python structure
                    obj = GraphSession.objects.filter(id=task.gs_id)[0]
                    obj.quicksave_pickle = to_djangodb_str(session.graph)
                    obj.save()
                    
                    # mat file
                    if not os.path.exists(settings.MATFILES_DIRNAME):
                        os.makedirs(settings.MATFILES_DIRNAME)
                    filepath = os.path.join(settings.MATFILES_DIRNAME, task.gs_id + ".mat")
                    save_fct = session.graph.get_save_fct()
                    save_fct(filepath)
                    
                    # return
                    graphreply = GraphReply(reqid=task.reqid, reply_json='null' )
                    graphreply.save()

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
        logging.basicConfig(level=logging.INFO, format='%(threadName)-3s: %(message)s' )

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

