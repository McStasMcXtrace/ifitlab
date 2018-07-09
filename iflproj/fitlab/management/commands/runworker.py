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

from django.utils import timezone
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

        tree = enginterface.TreeJsonAddr(json.loads(self._loadNodeTypesJsFile()))
        pmod = json.loads(open('pmodule.json').read())
        mdl = importlib.import_module(pmod["module"], pmod["package"]) # rewrite fom package = dot ! 
        self.graph = enginterface.FlatGraph(tree, mdl)

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

    def test(self):
        cmds = json.loads('[[["node_add",454.25,401.3333333333333,"o0","","","obj"],["node_rm","o0"]],[["node_add",382.75,281.3333333333333,"o1","","","Pars"],["node_rm","o1"]],[["node_add",348,367.3333333333333,"f0","","C","Colour"],["node_rm","f0"]],[["link_add","o1",0,"f0",0,0],["link_rm","o1",0,"f0",0,0]],[["link_add","f0",0,"o0",0,0],["link_rm","f0",0,"o0",0,0]],[["node_data","o1","\\"red\\""],["node_data","o1",{}]]]')

        self.graph.graph_change(cmds)
        self.graph.execute_node("o0")

'''
Utility
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

'''
cmd impl.
'''

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

    def get_soft_session(self, task):
        ''' if this returns None, a session must be created or loaded '''
        return self.sessions.get(task.gs_id, None)

    def shutdown_session(self, task):
        ''' a hard shutdown, nothing is saved '''
        session = self.sessions.get(task.gs_id, None)
        if session:
            session.graph.shutdown()
            del session.graph[task.gs_id]

    def quickload_repair_and_reset_nonliteral_data(self, task):
        try:
            obj = GraphSession.objects.filter(id=task.gs_id)[0]
        except:
            raise Exception("requested gs_id yielded no soft graph session or db object")
        if obj.username != task.username:
            raise Exception("username validation failed for session id: %s, sender: %s" % (obj.username, task.username))

        try:
            # fall back to graphdef injection (no soft data works), and a db object reset
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph.inject_graphdef(json.loads(obj.quicksave_graphdef))

            obj.quicksave_matfile = ""
            obj.quicksave_pickle = to_djangodb_str(session.graph)
            obj.quicksaved = timezone.now()
            obj.save()
            self.sessions[task.gs_id] = session
        except Exception as e:
            logging.error("fallback loading failed, not looking good (%s)" % str(e))

        return self.sessions.get(task.gs_id, None)

    def quickload_session(self, task):
        ''' use only if the session does not exists, or if you also shut down the previous session first '''
        logging.info("loading quicksaved session, gs_id: %s" % task.gs_id)

        # load gs from DB
        obj = None
        try:
            obj = GraphSession.objects.filter(id=task.gs_id)[0]
        except:
            raise Exception("requested gs_id yielded no soft graph session or db object")
        if obj.username != task.username:
            raise Exception("username validation failed for session id: %s, sender: %s" % (obj.username, task.username))

        try:
            if not obj.quicksaved:
                raise Exception("quickload_session: 'quicksaved' timezone flag was never set")

            # load python & matlab structures
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph = from_djangodb_str(obj.quicksave_pickle)
            filepath = os.path.join(settings.MATFILES_DIRNAME, obj.quicksave_matfile)
            session.graph.middleware.get_load_fct()(filepath)
            self.sessions[task.gs_id] = session

        except Exception as e:
            logging.error("loading failed, repqiring... (%s)" % str(e))

        return self.sessions.get(task.gs_id, None)

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
                # attach/load-attach
                if task.cmd == "load":
                    session = self.get_soft_session(task)
                    if not session: 
                        session = self.quickload_session(task)
                    
                    gd = None
                    update = None
                    try:
                        gd = session.graph.extract_graphdef()
                        update = session.graph.extract_update()
                    except:
                        # graphdef fallback
                        session = self.quickload_repair_and_reset_nonliteral_data(task)
                        if not session:
                            raise Exception("session could not be loaded: %s" % task.gs_id)
                        gd = session.graph.extract_graphdef()
                    
                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps( { "graphdef" : gd, "update" : update} ))
                    graphreply.save()

                # save
                elif task.cmd == "save":
                    session = self.get_soft_session(task)

                    anyerrors = session.graph.graph_update(task.sync_obj)
                    if anyerrors:
                        raise Exception("errors encountered during sync")

                    # python structure
                    obj = GraphSession.objects.filter(id=task.gs_id)[0]
                    obj.quicksave_pickle = to_djangodb_str(session.graph)
                    obj.quicksave_graphdef = json.dumps( session.graph.extract_graphdef() )

                    # mat file
                    if not os.path.exists(settings.MATFILES_DIRNAME):
                        os.makedirs(settings.MATFILES_DIRNAME)
                    filepath = os.path.join(settings.MATFILES_DIRNAME, task.gs_id + ".mat")
                    save_fct = session.graph.middleware.get_save_fct()
                    save_fct(filepath)
                    obj.quicksave_matfile = filepath
                    obj.quicksaved = timezone.now()
                    obj.save()

                    # return
                    graphreply = GraphReply(reqid=task.reqid, reply_json='null' )
                    graphreply.save()

                # save-copy
                elif task.cmd == "branch":
                    raise Exception("branch has not been implemented")

                # update & run
                elif task.cmd == "update_run":
                    session = self.get_soft_session(task)
                    json_obj = session.update_and_execute(task.sync_obj['run_id'], task.sync_obj['sync'])
                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps(json_obj))
                    graphreply.save()

                # save & shutdown
                elif task.cmd == "autosave_shutdown":
                    raise Exception("save_shutdown has not been implemented")

                    session = self.get_soft_session(task)
                    # TODO: save
                    session.graph.middleware.finalize()

                elif task.cmd == "shutdown":
                    raise Exception("shutdown has not been implemented")

                    session = self.get_soft_session(task)
                    session.graph.middleware.finalize()

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

