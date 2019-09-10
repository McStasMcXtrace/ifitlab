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
from queue import Queue, Empty

from django.utils import timezone
from django.core.management.base import BaseCommand
from django.contrib.auth.models import User

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))

import nodespeak
from iflproj import settings
from fitlab.models import GraphUiRequest, GraphReply, GraphSession
import enginterface
from fitlab.management.commands import purgemessages
from loggers import log_workers as _log, _log_sysmon 

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
        pmod = json.loads(open('pmodule.js').read())
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

        self.tcln = threading.Thread(target=self.cleanup_wrk)
        self.tcln.setDaemon(True)
        self.tcln.setName('%s_cleanup' % (self.tcln.getName().replace('Thread-','T')))
        self.tcln.start()
        self.termination_events[self.tcln.getName()] = threading.Event()

        self.tmon = threading.Thread(target=self.monitor_wrk)
        self.tmon.setDaemon(True)
        self.tmon.setName('%s_monitor' % (self.tmon.getName().replace('Thread-','T')))
        self.tmon.start()
        self.termination_events[self.tmon.getName()] = threading.Event()

        self.shutdownlock = threading.Lock()
        self.waiting_for_termination = threading.Event()
        self.waiting_for_termination.clear()

    def terminate(self):
        self.terminated = True
        for key in self.termination_events.keys():
            e = self.termination_events[key]
            e.wait()

    def monitor_wrk(self):
        try:
            while not self.terminated:
                last = timezone.now()

                _log("gathering statistics...")

                # db users
                num_users = len(User.objects.all())
                # db sessions
                num_sessions = len(GraphSession.objects.all())
                # live data
                num_livesessions = len(self.sessions.keys())
                # number of graph handles holding objects
                num_hothandles = 0
                for key in self.sessions:
                    ses = self.sessions[key]
                    # WARNING: encapsulate this impl. into e.g. enginterface
                    for key in ses.graph.root.subnodes:
                        n = ses.graph.root.subnodes[key]
                        if type(n) in (nodespeak.ObjNode, ) and n.get_object() != None:
                            num_hothandles += 1
                # accumulated middleware varnames
                num_middleware_vars = 0
                for key in self.sessions:
                    ses = self.sessions[key]
                    num_middleware_vars += len(ses.graph.middleware.varnames)
                # total matlab vars
                num_matlab_vars = 0
                try:
                    someses = self.sessions[next(iter(self.sessions))]
                    who = someses.graph.middleware.totalwho()
                    num_matlab_vars = len(who)
                except Exception as e:
                    pass

                # log monitored values
                _log_sysmon(num_users, num_sessions, num_livesessions, num_hothandles, num_middleware_vars, num_matlab_vars)

                while (not self.terminated) and (timezone.now() - last).seconds < settings.WRK_MONITOR_INTERVAL_S:
                    time.sleep(1)

            _log("exiting...")
        finally:
            self.termination_events[self.tmon.getName()].set()

    def cleanup_wrk(self):
        ''' cleanup thread retires sessions that are "touched" longer ago than X time'''
        try:
            while not self.terminated:
                last = timezone.now()

                while (not self.terminated) and (timezone.now() - last).seconds < settings.WRK_CLEANUP_INTERVAL_S:
                    time.sleep(1)

                _log("cleaning up sessions...")
                keys = [key for key in self.sessions.keys()]
                for key in keys:
                    ses = self.sessions.get(key, None) # thread safe way
                    if not ses:
                        continue
                    if (timezone.now() - ses.touched).seconds > settings.WRK_SESSION_RETIRE_TIMEOUT_S:
                        self.shutdown_session(ses.gs_id)
    
            _log("clean up retiring sessions...")
            keys = [key for key in self.sessions.keys()]
            for key in keys:
                ses = self.sessions.get(key, None) # thread safe way
                if not ses:
                    continue
                self.shutdown_session(ses.gs_id)

        finally:
            self.termination_events[self.tcln.getName()].set()

    def get_soft_session(self, task):
        ''' if this returns None, a session must be created or loaded '''
        s = self.sessions.get(task.gs_id, None)
        if s:
            s.touch()
        return s

    def extract_log(self, session):
        if not session:
            raise Exception("extract_logs: null session given")

        # get new logtext
        loglines = session.graph.middleware.extract_loglines()
        logtext = "".join(loglines)

        # append and save
        obj = GraphSession.objects.filter(id=session.gs_id)[0]
        prevlog = obj.loglines
        if prevlog == None:
            prevlog = ""

        # filter previous log to contain only the currently registered varnames
        regexs = [re.compile(vn) for vn in session.graph.middleware.varnames]
        lst = []
        for l in prevlog.splitlines():
            if True in [r.search(l)!=None for r in regexs]:
                lst.append(l)
        prevlog = "\n".join(lst)

        # save to disk
        obj.loglines = prevlog + logtext
        obj.logheader = session.graph.middleware.get_logheader()
        obj.save()

    def shutdown_session(self, gs_id, nosave=False):
        ''' shuts down a session the right way '''
        _log("retiring session %s" % gs_id)

        with self.shutdownlock:
            session = self.sessions.get(gs_id, None)
            if session:
                try:
                    if not nosave:
                        self.autosave(session)
                    self.extract_log(session)
                    session.graph.shutdown()
                    del self.sessions[gs_id]
                except Exception as e:
                    _log("session shutdown error: " + str(e) + " (%s)" % gs_id, error=True)

    def load_session(self, task):
        ''' fallbacks are: load -> revert -> reconstruct '''
        _log("autoloading stashed session (%s)" % task.gs_id)

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
                raise Exception("'stashed' timezone.time flag was null")

            # load python & matlab structures
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph = from_djangodb_str(obj.stashed_pickle)
            filepath = os.path.join(settings.MATFILES_DIRNAME, obj.stashed_matfile)
            session.graph.middleware.get_load_fct()(filepath)
            self.sessions[task.gs_id] = session

        except Exception as e:
            _log("autoload failed... (%s)" % str(e), error=True)
            return self.revert_session(task)

        return self.sessions.get(task.gs_id, None)

    def revert_session(self, task):
        ''' fallbacks are: load -> revert -> reconstruct '''
        _log("reverting quicksaved session (%s)" % task.gs_id)

        # load gs from DB
        obj = None
        try:
            obj = GraphSession.objects.filter(id=task.gs_id)[0]
        except:
            raise Exception("requested gs_id yielded no db object")
        if obj.username != task.username:
            raise Exception("username validation failed for session id: %s, sender: %s" % (obj.username, task.username))

        try:
            if not obj.quicksaved:
                raise Exception("'quicksaved' timezone.time flag was never set")

            # load python & matlab structures
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph = from_djangodb_str(obj.quicksave_pickle)
            filepath = os.path.join(settings.MATFILES_DIRNAME, obj.quicksave_matfile)
            session.graph.middleware.get_load_fct()(filepath)
            self.sessions[task.gs_id] = session

        except Exception as e:
            _log("revert failed (%s)" % str(e), error=True)
            # fallback: reconstruct
            return self.reconstruct_session(task)

        return self.sessions.get(task.gs_id, None)

    def reconstruct_session(self, task):
        ''' fallbacks are: load -> revert -> reconstruct '''
        _log("reconstructing session from graphdef (%s)" % task.gs_id)

        try:
            obj = GraphSession.objects.filter(id=task.gs_id)[0]
        except:
            raise Exception("requested gs_id yielded no db object")
        if obj.username != task.username:
            raise Exception("username validation failed for session id: %s, sender: %s" % (obj.username, task.username))

        session = None
        try:
            session = SoftGraphSession(task.gs_id, obj.username)
            session.graph.inject_graphdef(json.loads(obj.graphdef))
            
            # delete the matfile and reference
            if os.path.exists(obj.quicksave_matfile):
                os.remove(obj.quicksave_matfile)
            if os.path.exists(obj.stashed_matfile):
                os.remove(obj.stashed_matfile)
            obj.quicksave_matfile = ""
            obj.stashed_matfile = ""
            # over-write the pickle
            obj.quicksave_pickle = to_djangodb_str(session.graph)
            obj.stashed_pickle = to_djangodb_str(session.graph)
            # reset
            obj.quicksaved = timezone.now()
            obj.stashed = timezone.now()
            obj.save()
            self.sessions[task.gs_id] = session
        except Exception as e:
            _log("reconstruct failed: %s" % str(e), error=True)

        return session

    def autosave(self, session):
        # python structure
        obj = GraphSession.objects.filter(id=session.gs_id)[0]
        obj.stashed_pickle = to_djangodb_str(session.graph)

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
        obj.graphdef = json.dumps( session.graph.extract_graphdef() )

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
        sess = self.sessions
        return [sess[key] for key in sess.keys() if sess[key].username == task.username]

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

            _log("doing task '%s' (%s)" % (task.cmd, task.gs_id))
            try:
                # attach/load-attach
                if task.cmd == "load":
                    session = self.get_soft_session(task)
                    if not session:
                        session = self.load_session(task)
                    
                    gd = None
                    update = None
                    try:
                        gd = session.graph.extract_graphdef()
                        update = session.graph.extract_update()
                        
                        graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "graphdef" : gd, "dataupdate" : update }))
                        graphreply.save()
                    except:
                        _log("autoload failed, requesting fallback cmd='revert' (%s)" % task.gs_id, error=True)
                        task.cmd = "revert"
                        self.taskqueue.put(task)

                # revert - to last active save
                elif task.cmd == "revert":
                    # cleanup & remove any active session
                    self.shutdown_session(task.gs_id, nosave=True)
                    # quickload the session AKA revert
                    session = self.revert_session(task)

                    # construct the graph reply
                    gd = None
                    update = None
                    try:
                        gd = session.graph.extract_graphdef()
                        update = session.graph.extract_update()
                    except:
                        if not session:
                            raise Exception("session could not be reverted: %s" % task.gs_id)

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "graphdef" : gd, "dataupdate" : update }))
                    graphreply.save()

                # reset
                elif task.cmd == "reset":
                    self.shutdown_session(task.gs_id, nosave=True)

                    obj = GraphSession.objects.filter(id=task.gs_id)[0]

                    obj.stashed_pickle = "reset"
                    obj.quicksave_pickle = "reset"
                    obj.loglines = ""
                    obj.logheader = ""
                    obj.stashed_matfile = ""
                    obj.quicksave_matfile = ""
                    obj.save()

                    gd = None
                    update = None

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "graphdef" : gd, "dataupdate" : update }))
                    graphreply.save()

                # save
                elif task.cmd == "save":
                    session = self.get_soft_session(task)
                    if not session:
                        raise Exception("save failed: session was not live (%s)" % task.gs_id)

                    anyerrors = session.graph.graph_update(task.sync_obj['sync'])
                    if anyerrors:
                        raise Exception("errors encountered during update: %s" % anyerrors)

                    session.graph.graph_coords(task.sync_obj['coords'])
                    self.quicksave(session)

                    graphreply = GraphReply(reqid=task.reqid, reply_json='{"message" : "save success"}' )
                    graphreply.save()

                # update & run
                elif task.cmd == "update_run":
                    session = self.get_soft_session(task)
                    if not session:
                        raise Exception("save failed: session was not live (%s)" % task.gs_id)

                    json_obj = session.update_and_execute(task.sync_obj['run_id'], task.sync_obj['sync'])

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps(json_obj))
                    graphreply.save()

                # update
                elif task.cmd == "update":
                    session = self.get_soft_session(task)
                    if not session:
                        raise Exception("save failed: session was not live (%s)" % task.gs_id)
                    
                    error1 = session.graph.graph_update(task.sync_obj['sync'])
                    error2 = session.graph.graph_coords(task.sync_obj['coords'])
                    
                    # purge previous graph replies (depending on view setting, these may not be read)
                    # TODO: impl

                    # NOTE: at this time, update replies are not read and not needed
                    #graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps(error1))
                    #graphreply.save()

                # clear objects
                elif task.cmd == "clear_data":
                    session = self.get_soft_session(task)
                    if not session:
                        raise Exception("save failed: session was not live (%s)" % task.gs_id)

                    session.graph.reset_all_objs()
                    update = session.graph.extract_update()
                    
                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "dataupdate" : update }))
                    graphreply.save()

                # extract log lines
                elif task.cmd == "extract_log":
                    session = self.get_soft_session(task)
                    if not session:
                        raise Exception("save failed: session was not live (%s)" % task.gs_id)
                    
                    self.extract_log(session)

                    graphreply = GraphReply(reqid=task.reqid, reply_json='{"message" : "command log extraction successful"}' )
                    graphreply.save()

                # save & shutdown
                elif task.cmd == "autosave_shutdown":
                    for session in self.get_user_softsessions(task):
                        self.shutdown_session(task.gs_id)

                    graphreply = GraphReply(reqid=task.reqid, reply_json='{"message" : "save-shutdown successful"}' )
                    graphreply.save()

                # hard shutdown
                elif task.cmd == "shutdown":
                    session = self.get_soft_session(task)
                    session.graph.shutdown()

                # create / new
                elif task.cmd == "new":
                    obj = GraphSession()
                    obj.example=False
                    obj.username = task.username
                    obj.description = ""
                    obj.title = ""
                    obj.example = False
                    obj.excomment = ""
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

                    # copy graph structure and literal data
                    gd = None
                    obj = GraphSession.objects.filter(id=task.gs_id)[0]
                    if obj.username != task.username and obj.example == False:
                        raise Exception("will not clone non-example session from other users")
                    ses = self.get_soft_session(task)
                    if not ses:
                        gd = json.loads(obj.graphdef)
                    else:
                        gd = ses.graph.extract_graphdef()

                    newobj.graphdef = json.dumps(gd)
                    newobj.example = False
                    newobj.title = obj.title + " [CLONE]"
                    newobj.description = obj.description
                    newobj.username = task.username
                    newobj.stashed = timezone.now()
                    newobj.save()

                    graphreply = GraphReply(reqid=task.reqid, reply_json=newobj.id )
                    graphreply.save()

                # delete
                elif task.cmd == "delete":
                    self.shutdown_session(task.gs_id)

                    obj = GraphSession.objects.filter(id=task.gs_id)[0]
                    if os.path.exists(obj.stashed_matfile):
                        os.remove(obj.stashed_matfile)
                    if os.path.exists(obj.quicksave_matfile):
                        os.remove(obj.quicksave_matfile)
                    obj.delete()

                    graphreply = GraphReply(reqid=task.reqid, reply_json='{"message" : "delete success"}' )
                    graphreply.save()


                # reset all sessions (admin command)
                elif task.cmd == "admin_resetall":
                    sesionobjs = GraphSession.objects.all()
                    numreset = 0
                    for obj in sesionobjs:
                        # TODO: create a plural shutdown_sessions to improve lock acquisition performance
                        self.shutdown_session(str(obj.id), nosave=False)

                        if obj.stashed_pickle != "reset":
                            numreset = numreset + 1

                        obj.stashed_pickle = "reset"
                        obj.quicksave_pickle = "reset"
                        obj.loglines = ""
                        obj.logheader = ""
                        obj.stashed_matfile = ""
                        obj.quicksave_matfile = ""
                        obj.save()
                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "msg" : "sessions activaly reset: %d" % numreset }))
                    graphreply.save()

                # shutdown all sessions (admin command)
                elif task.cmd == "admin_shutdownall":
                    numshutdown = 0
                    keys = list(self.sessions)
                    for k in keys:
                        # (k becomes the session id)
                        self.shutdown_session(k, nosave=False)
                        numshutdown = numshutdown + 1

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "msg" : "sessions shut down: %d" % numshutdown }))
                    graphreply.save()

                # shutdown all sessions (admin command)
                elif task.cmd == "admin_showvars":
                    who = []
                    try:
                        someses = self.sessions[next(iter(self.sessions))]
                        who = someses.graph.middleware.totalwho()
                    except:
                        pass

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "vars" : who }))
                    graphreply.save()

                # execute live matlab command (admin command)
                elif task.cmd == "admin_matlabcmd":
                    mlcmd = task.sync_obj["mlcmd"]
                    nargout = task.sync_obj["nargout"]

                    sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
                    import ifitlib
                    ans = ifitlib._eval(mlcmd, nargout=nargout, dontlog=True)

                    graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps({ "ans" : json.dumps(ans) }))
                    graphreply.save()

                #
                else:
                    raise Exception("invalid command: %s" % task.cmd)

                _log("task done")

            except Exception as e:
                _log("fatal error: " + str(e), error=True)

                graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps( { "fatalerror" : str(e) } ))
                graphreply.save()

        _log("exit")
        self.termination_events[threading.current_thread().getName()].set()


class Command(BaseCommand):
    help = 'started in a separate process, required for any work to be done'

    def handle(self, *args, **options):
        _log("purging messages...")

        c = purgemessages.Command()
        c.handle()

        workers = Workers()
        
        _log("starting workers...")
        _log("looking for tasks...")
        try:
            while True:
                workers.mainwork()
                time.sleep(0.1)

        # ctr-c exits
        except KeyboardInterrupt:
            print("")
            _log("shutdown requested, exiting...")
            workers.terminate()
            print("")

