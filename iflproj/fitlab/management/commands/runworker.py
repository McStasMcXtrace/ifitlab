'''
Worker process which handles all graph sessions, in parallel.
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
from django.utils import timezone

sys.path.append(os.path.join(os.path.dirname(__file__), '..', '..', '..'))


from fitlab.models import GraphUiRequest, GraphReply, GraphSession
import enginterface


NUM_THREADS = 4


'''
def load_graph_def(username, request):
    username = request.session['username']
    gd = GraphDef.objects.filter(username__exact=username)
    graphdef_json = gd[0].graphdef_json
    print('loading graph def for user %s: %s chars' % (username, len(graphdef_json)))

    return graphdef_json
    
def ajax_save_graph_def(request):
    s = request.POST.get('graphdef')

    username = request.session['username']
    existing = GraphDef.objects.filter(username__exact=username)
    existing.delete()
    gd = GraphDef(graphdef_json=s, username=username)
    gd.save()
'''


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



class ExitException(Exception): pass


class Task:
    def __init__(self, username, gs_id, sync_obj_str, reqid, cmd="update"):
        self.username = username
        self.gs_id = gs_id
        self.reqid = reqid
        self.sync_obj = json.loads(sync_obj_str)
        self.cmd = cmd

def get_work():
    lst = GraphUiRequest.objects.all()
    if len(lst) > 0:
        uireq = lst[0]
        work = Task(uireq.username, uireq.gs_id, uireq.syncset, uireq.id)
        uireq.delete()
        return work

def threadwork(task, softsession, semaphore=None):
    if not task.cmd == "update":
        raise Exception('work.cmd != "update" has not been implemented')
    try:
        # run
        json_obj = softsession.update_and_execute(task.sync_obj['run_id'], task.sync_obj['sync'])
        # loot
        graphreply = GraphReply(reqid=task.reqid, reply_json=json.dumps(json_obj))
        graphreply.save()
        # log
        # TODO: log
        
    except Exception as e:
        # TODO: thread-log this
        print(str(e))
        # save fail state / raise ?
    finally:
        if semaphore:
            semaphore.release()

all_soft_sessions = {}
def mainwork(threaded=True, semaphore=None):
    global all_soft_sessions

    # TODO: find a nice way to impl. various types of tasks:
    # update (we have this default)
    # save
    # load_attach
    # save_copy
    # shutdown
    # autosave_shutdown
    task = get_work()

    while task:
        # exceptions raised during work do not break the processing loop
        try:
            # get or create the appropriate session
            session = all_soft_sessions.get(task.gs_id, None)
            if not session:
                try:
                    obj = GraphSession.objects.filter(id=task.gs_id)[0]
                except:
                    raise Exception("requested gs_id yielded no soft graph session or db object")
                # username validation
                if obj.username != task.username:
                    raise Exception("username validation failed, sender: %s, session: %s" % (task.username, obj.username))
                session = SoftGraphSession(task.gs_id, obj.username)
                all_soft_sessions[task.gs_id] = session

            # work
            if threaded:
                semaphore.acquire() # this will block until a slot is released

                t = threading.Thread(target=threadwork, args=(task, session, semaphore))
                t.setDaemon(True)
                t.setName('%s (%s)' % (t.getName().replace('Thread-','T'), '%s (username: %s)' % (task.gs_id, task.username)))
                t.start()
            else:
                threadwork(task, session)

        except Exception as e:
            logging.error('fail: %s (%s)' % (e.__str__(), type(e).__name__))

        finally:
            task = get_work()
            if not task:
                logging.info("idle...")


class Command(BaseCommand):
    help = 'start this in a separate process, it is required for any work to be done'

    def add_arguments(self, parser):
        parser.add_argument('--debug', action='store_true', help="run work() only once using main thread")
        parser.add_argument('--singlethreaded', action='store_true', help="run work() using main thread only")

    def handle(self, *args, **options):
        logging.basicConfig(level=logging.INFO, format='%(threadName)-22s: %(message)s' )

        try:
            # debug run
            if options['debug']:
                mainwork(threaded=False)
                exit()
            
            # single threaded run
            threaded = True
            if options['singlethreaded']:
                threaded = False

            # main threaded execution loop:
            sema = threading.BoundedSemaphore(NUM_THREADS)
            logging.info("created semaphore with %d slots" % NUM_THREADS)

            logging.info("looking for work...")
            while True:
                mainwork(threaded=threaded, semaphore=sema)
                time.sleep(0.3)

        # ctr-c exits
        except KeyboardInterrupt:
            print("")
            logging.info("shutdown requested, exiting...")
            print("")
            print("")

        # handle exit-exception (programmatic shutdown)
        except ExitException as e:
            print("")
            logging.warning("exit exception raised, exiting (%s)" % e.__str__())
            print("")
            print("")


