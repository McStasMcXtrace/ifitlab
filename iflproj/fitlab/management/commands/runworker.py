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
from fitlab.models import GraphUiRequest, GraphReply, GraphSession
import enginterface
from fitlab.management.commands import purgemessages

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

        self.touched = timezone.now()

    def _loadNodeTypesJsFile(self):
        text = open('fitlab/static/fitlab/nodetypes.js').read()
        m = re.search("var nodeTypes\s=\s([^;]*)", text, re.DOTALL)
        return m.group(1)

    def update_and_execute(self, runid, syncset):
        ''' returns engine update set '''
        error = self.graph.graph_update(syncset)
        if error:
            return error
        return self.graph.execute_node(runid)

    def touch(self):
        self.touched = timezone.now()

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
    def __init__(self):
        self.taskqueue = Queue()
        self.sessions = {}
        self.terminated = False

        self.threads = []
        self.termination_events = {}
        for i in range(NUM_THREADS):
            t = threading.Thread(target=self.threadwork)
            t.setDaemon(True)
            t.setName('%s' % (t.getName().replace('Thread-','T')))
            t.start()
            self.threads.append(t)
            self.termination_events[t.getName()] = threading.Event()

        self.tcln = threading.Thread(target=self.cleanupwork)
        self.tcln.setDaemon(True)
        self.tcln.setName('%s' % (self.tcln.getName().replace('Thread-','T')))
        self.tcln.start()
        
        self.termination_events[self.tcln.getName()] = threading.Event()
        
        self.shutdownlock = threading.Lock()
        self.waiting_for_termination = threading.Event()
        self.waiting_for_termination.clear()

    def terminate(self):
        self.terminated = True
        for key in self.termination_events.keys():
            e = self.termination_events[key]
            e.wait()

    def cleanupwork(self):
        ''' cleanup thread - retires sessions that are touched longer ago than settings timeout'''
        try:
            while not self.terminated:
                now = timezone.now()

                while not self.terminated and (timezone.now() - now).seconds < settings.WRK_CLEANUP_INTERVAL_S:
                    time.sleep(1)

                logging.info("cleaning up sessions...")
                keys = [key for key in self.sessions.keys()]
                for key in keys:
                    ses = self.sessions.get(key, None) # thread safe way
                    if not ses:
                        continue
                    if (ses.touched - timezone.now()).seconds > settings.WRK_SESSION_RETIRE_TIMEOUT_S:
                        self.shutdown_autosave(ses.gs_id)
    
            logging.info("clean up retiring sessions...")
            keys = [key for key in self.sessions.keys()]
            for key in keys:
                ses = self.sessions.get(key, None) # thread safe way
                if not ses:
                    continue
                self.shutdown_autosave(ses)

        finally:
            self.termination_events[self.tcln.getName()].set()

    def get_soft_session(self, task):
        ''' if this returns None, a session must be created or loaded '''
        s = self.sessions.get(task.gs_id, None)
        if s:
            s.touch()
        return s

    def shutdown_hard(self, task):
        ''' hard shutdown (nothing is saved) by task '''
        logging.info("shutting down session %s (no save)" % task.gs_id)
        self.shutdownlock.acquire()

        try:
            session = self.sessions.get(task.gs_id, None)
            if session:
                session.graph.shutdown()
                del self.sessions[task.gs_id]
        except Exception as e:
            logging.error("error: " + str(e))
        finally:
            self.shutdownlock.release()

    def shutdown_autosave(self, gs_id):
        '''  '''
        logging.info("retiring session %s" % gs_id)
        self.shutdownlock.acquire()

        session = self.sessions.get(gs_id, None)
        try:
            if session:
                self.autosave(session)
                session.graph.shutdown()
                del self.sessions[gs_id]
        except Exception as e:
            logging.error("error: " + str(e))
        finally:
            self.shutdownlock.release()

    def load_from_stashed_graphdef(self, task):
        pass

    def quickload_repair_and_reset_nonliteral_data(self, task):
        '''
        Used to clean up sessions after a failed load, this method discards pickle and matfile data, and reinserts
        new data using the quicksave graphdef json object.
        '''
        try:
            obj = GraphSession.objects.filter(id=task.gs_id)[0]
        except:
            raise Exception("requested gs_id yielded no soft graph session or db object")
        if obj.username != task.username:
            raise Exception("username validation failed for session id: %s, sender: %s" % (obj.username, task.username))

        try:
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph.inject_graphdef(json.loads(obj.quicksave_graphdef))
            
            # delete the matfile and reference
            if os.path.exists(obj.quicksave_matfile):
                os.remove(obj.quicksave_matfile)
            obj.quicksave_matfile = ""
            # over-write the pickle
            obj.quicksave_pickle = to_djangodb_str(session.graph)
            # reset
            obj.quicksaved = timezone.now()
            obj.save()
            self.sessions[task.gs_id] = session
        except Exception as e:
            logging.error("fallback loading failed, not looking good (%s)" % str(e))

        return self.sessions.get(task.gs_id, None)

    def quickload_session(self, task):
        logging.info("reverting quicksaved session, gs_id: %s" % task.gs_id)

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
                raise Exception("quickload_session: 'quicksaved' timezone.time flag was never set")

            # load python & matlab structures
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph = from_djangodb_str(obj.quicksave_pickle)
            filepath = os.path.join(settings.MATFILES_DIRNAME, obj.quicksave_matfile)
            session.graph.middleware.get_load_fct()(filepath)
            self.sessions[task.gs_id] = session

        except Exception as e:
            logging.error("quickload failed (%s)" % str(e))

        return self.sessions.get(task.gs_id, None)

    def autoload_session(self, task):
        logging.info("autoloading stashed session, gs_id: %s" % task.gs_id)

        # load gs from DB
        obj = None
        try:
            obj = GraphSession.objects.filter(id=task.gs_id)[0]
        except:
            raise Exception("requested gs_id yielded no db object: %s" % task.gs_id)
        if obj.username != task.username:
            raise Exception("username validation failed for session id: %s, sender: %s" % (obj.username, task.username))

        try:
            if not obj.stashed:
                raise Exception("autoload_session: 'stashed' timezone.time flag was never set")

            # load python & matlab structures
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph = from_djangodb_str(obj.stashed_pickle)
            filepath = os.path.join(settings.MATFILES_DIRNAME, obj.stashed_matfile)
            session.graph.middleware.get_load_fct()(filepath)
            self.sessions[task.gs_id] = session

        except Exception as e:
            logging.error("autoload failed... (%s)" % str(e))

        return self.sessions.get(task.gs_id, None)

    def autosave(self, session):
        # python structure
        obj = GraphSession.objects.filter(id=session.gs_id)[0]
        obj.stashed_pickle = to_djangodb_str(session.graph)
        obj.stashed_graphdef = json.dumps( session.graph.extract_graphdef() )

        # mat file
        if not os.path.exists(settings.MATFILES_DIRNAME):
            os.makedirs(settings.MATFILES_DIRNAME)
        filepath = os.path.join(settings.MATFILES_DIRNAME, session.gs_id + "_autosave.mat")
        save_fct = session.graph.middleware.get_save_fct()
        save_fct(filepath)
        obj.stashed_matfile = filepath
        obj.stashed = timezone.now()
        obj.save()

    def quicksave(self, session):
        # python structure
        obj = GraphSession.objects.filter(id=session.gs_id)[0]
        obj.quicksave_pickle = to_djangodb_str(session.graph)
        obj.quicksave_graphdef = json.dumps( session.graph.extract_graphdef() )

        # mat file
        if not os.path.exists(settings.MATFILES_DIRNAME):
            os.makedirs(settings.MATFILES_DIRNAME)
        filepath = os.path.join(settings.MATFILES_DIRNAME, session.gs_id + ".mat")
        save_fct = session.graph.middleware.get_save_fct()
        save_fct(filepath)
        obj.quicksave_matfile = filepath
        obj.quicksaved = timezone.now()
        obj.save()

    def get_user_softsessions(self, task):
        ses = self.sessions
        return [ses[key] for key in ses.keys() if ses[key].username == task.username]

    def mainwork(self):
        ''' Process a batch of UIRequest objects. Called from the main thread. '''
        for uireq in GraphUiRequest.objects.all():
            self.taskqueue.put(Task(uireq.username, uireq.gs_id, uireq.syncset, uireq.id, uireq.cmd))
            uireq.delete()

    def threadwork(self):
        # check for the self.terminated=True signal every timeout seconds
        task = None
        while not self.terminated:
            try:
                task = self.taskqueue.get(block=True, timeout=0.1)
            except Empty:
                task = None
            if not task:
                continue

            logging.info("doing task '%s', session id: %s" % (task.cmd, task.gs_id))
            try:
                # attach/load-attach
                if task.cmd == "load":
                    session = self.get_soft_session(task)
                    if not session:
                        session = self.autoload_session(task)
                    
                    gd = None
                    update = None
                    try:
                        gd = session.graph.extract_graphdef()
                        update = session.graph.extract_update()
                        
                        graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps( { "graphdef" : gd, "dataupdate" : update} ))
                        graphreply.save()
                    except:
                        # revert as autoload fallback (?)
                        logging.info("autoload failed, requiesting fallback cmd='revert', session id: %s" % task.gs_id)
                        task.cmd = "revert"
                        self.taskqueue.put(task)

                # revert AKA "manual" load
                elif task.cmd == "revert":
                    # cleanup & remove any active session
                    self.shutdown_hard(task)
                    
                    # autoload the session AKA revert
                    session = self.quickload_session(task)
                    
                    # construct the graph reply
                    gd = None
                    update = None
                    try:
                        gd = session.graph.extract_graphdef()
                        update = session.graph.extract_update()
                    except:
                        # "dry graphdef" fallback
                        session = self.quickload_repair_and_reset_nonliteral_data(task)
                        if not session:
                            raise Exception("session could not be loaded: %s" % task.gs_id)
                        gd = session.graph.extract_graphdef()

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps( { "graphdef" : gd, "dataupdate" : update} ))
                    graphreply.save()

                # save
                elif task.cmd == "save":
                    session = self.get_soft_session(task)

                    anyerrors = session.graph.graph_update(task.sync_obj['sync'])
                    if anyerrors:
                        raise Exception("errors encountered during sync")

                    session.graph.graph_coords(task.sync_obj['coords'])
                    self.quicksave(session)

                    graphreply = GraphReply(reqid=task.reqid, reply_json='null' )
                    graphreply.save()

                # clone
                elif task.cmd == "branch":
                    raise Exception("branch has not been implemented")

                # update & run
                elif task.cmd == "update_run":
                    session = self.get_soft_session(task)
                    json_obj = session.update_and_execute(task.sync_obj['run_id'], task.sync_obj['sync'])

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps(json_obj))
                    graphreply.save()

                # update
                elif task.cmd == "update":
                    session = self.get_soft_session(task)
                    if not session:
                        raise Exception("update failed: session was not alive")
                    
                    error1 = session.graph.graph_update(task.sync_obj['sync'])
                    error2 = session.graph.graph_coords(task.sync_obj['coords'])
                    
                    # TODO: fix the error1 vs. error2 mess
                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps(error1))
                    graphreply.save()

                # save & shutdown
                elif task.cmd == "autosave_shutdown":
                    for session in self.get_user_softsessions(task):
                        self.shutdown_autosave(task.gs_id)

                    graphreply = GraphReply(reqid=task.reqid, reply_json='null' )
                    graphreply.save()

                # hard shutdown
                elif task.cmd == "shutdown":
                    session = self.get_soft_session(task)
                    session.graph.middleware.finalize()

                # create / new
                elif task.cmd == "new":
                    obj = GraphSession()
                    obj.example=False
                    obj.username = task.username
                    obj.save()
                    session = SoftGraphSession(gs_id=str(obj.id), username=obj.username)
                    self.sessions[obj.id] = session

                    self.quicksave(session)
                    self.autosave(session)

                    graphreply = GraphReply(reqid=task.reqid, reply_json=obj.id )
                    graphreply.save()

                # clone
                elif task.cmd == "clone":
                    newobj = GraphSession()
                    newobj.example = False
                    newobj.username = task.username
                    newobj.save()
                    newsession = SoftGraphSession(gs_id=str(newobj.id), username=newobj.username)

                    # copy graph structure and literal data
                    session = self.get_soft_session(task)
                    gd = None
                    if not session:
                        obj = GraphSession.objects.filter(id=task.gs_id)[0]
                        # TODO: is this correct (vs. quicksave_graphdef)?
                        gd = json.loads(obj.stashed_graphdef)
                    else:
                        gd = session.graph.extract_graphdef()
                    newsession.graph.inject_graphdef(gd)

                    # finalize
                    self.quicksave(newsession)
                    self.autosave(newsession)
                    self.sessions[newobj.id] = newsession

                    graphreply = GraphReply(reqid=task.reqid, reply_json=newobj.id )
                    graphreply.save()

                # delete
                elif task.cmd == "delete":
                    self.shutdown_hard(task)

                    obj = GraphSession.objects.filter(id=task.gs_id)[0]
                    if os.path.exists(obj.stashed_matfile):
                        os.remove(obj.stashed_matfile)
                    if os.path.exists(obj.quicksave_matfile):
                        os.remove(obj.quicksave_matfile)
                    obj.delete()

                    graphreply = GraphReply(reqid=task.reqid, reply_json="" )
                    graphreply.save()

                else:
                    raise Exception("invalid command: %s" % task.cmd)

                logging.info("task done")

            except Exception as e:
                logging.error("fatal error: " + str(e))

                graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps( { "fatalerror" : str(e) } ))
                graphreply.save()

        logging.info("exit")
        self.termination_events[threading.current_thread().getName()].set()

class Command(BaseCommand):
    help = 'started in a separate process, required for any work to be done'

    def handle(self, *args, **options):
        logging.basicConfig(level=logging.INFO, format='%(threadName)-3s: %(message)s' )

        logging.info("starting workers...")
        c = purgemessages.Command()
        c.handle()
        logging.info("looking for tasks...")

        workers = Workers()
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

