from django.shortcuts import render, redirect
from django.http import HttpResponse
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required

from .models import GraphUiRequest, GraphReply

import json
import re
import importlib
import time

import enginterface
import fitlab.models
from fitlab.models import GraphDef

def index(request):
    # TODO: this should open the login page or dashboard
    
    username = 'admin'
    password = 'admin123'

    user = authenticate(username=username, password=password)

    #if user is None or not user.is_active:
    #    return redirect(home)

    login(request, user)
    print("default user was logged in")
    request.session['username'] = username

    # reset the graph session
    graphsession = get_graph_session(username)
    graphsession.reset()
    print("graph session was reset")

    return render(request, "fitlab/main.html", context={ "gs_id" : "hest" })

@login_required
def graph_session(request, gs_id):
    if not fitlab.models.GraphSession.objects.filter(id=gs_id).exists():
        print("redirecting missing graph session to index...")
        return redirect(index)
    return render(request, "fitlab/main.html", context={ "gs_id" : gs_id })

@login_required
def ajax_run_node(request, gs_id):
    s = request.POST.get('json_str')
    if not s:
        return HttpResponse("ajax request FAIL");
    print("received command: %s" % s)

    # main
    username = request.session['username']
    syncset = request.POST.get('json_str')
    uireq = GraphUiRequest(username=username, syncset=syncset, gs_id=gs_id)
    uireq.save()
    reqid = uireq.id

    # emulate worker action:
    sync_obj = json.loads(uireq.syncset) # this would be polled from db
    graphsession = get_graph_session(username) # the gs py-object matching the request's gs_id, or create using db object info
    json_obj = graphsession.update_and_execute(sync_obj['run_id'], sync_obj['sync'])
    grep = GraphReply(username=uireq.username, reqid=uireq.id, reply_json=json.dumps(json_obj)) # work action
    # should something like this be in a finally block?
    grep.save()
    uireq.delete() # clean up

    # back to main
    reply_json = _poll_db_for_reply(username, reqid)
    if reply_json:
        return HttpResponse(reply_json)
    else:
        return HttpResponse("ajax request db poll timed out")

def _poll_db_for_reply(username, requid, timeout=30):
    ''' polling the db is used as a process sync mechanism '''
    t = time.time()
    while True:
        lst = GraphReply.objects.filter(username=username, reqid=requid)
        if len(lst) == 1:
            answer = lst[0].reply_json
            lst[0].delete()
            return answer
        if len(lst) > 1:
            raise Exception("more than one reply for single request - multi-processing issue detected")
        time.sleep(0.3)
        elapsed = time.time() - t
        if elapsed > timeout and timeout > 0:
            return None

@login_required
def ajax_load_graph_def(request, gs_id):
    username = request.session['username']
    print(gs_id)
    
    gd = GraphDef.objects.filter(username__exact=username, gs_id=gs_id)
    graphdef_json = gd[0].graphdef_json
    print('loading graph def for user %s: %s chars' % (username, len(graphdef_json)))
    return HttpResponse(graphdef_json)

@login_required
def ajax_save_graph_def(request, gs_id):
    s = request.POST.get('graphdef')

    username = request.session['username']
    existing = GraphDef.objects.filter(username__exact=username)
    existing.delete()
    gd = GraphDef(graphdef_json=s, username=username, gs_id=gs_id)
    gd.save()

    return HttpResponse("graphdef saved")

#
# ON ITS WAY TO RUNWORKER:
#

# single-threaded approach
graphsessions = {}
def get_graph_session(key):
    if not graphsessions.get(key):
        graphsessions[key] = GraphSession()
        print("a new GraphSession was created with key: ", key)
    return graphsessions[key]

class GraphSession:
    def __init__(self):
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
        mdl = importlib.import_module(pmod["module"], pmod["package"])
        self.graph = enginterface.FlatGraph(tree, mdl)

    def test(self):
        cmds = json.loads('[[["node_add",454.25,401.3333333333333,"o0","","","obj"],["node_rm","o0"]],[["node_add",382.75,281.3333333333333,"o1","","","Pars"],["node_rm","o1"]],[["node_add",348,367.3333333333333,"f0","","C","Colour"],["node_rm","f0"]],[["link_add","o1",0,"f0",0,0],["link_rm","o1",0,"f0",0,0]],[["link_add","f0",0,"o0",0,0],["link_rm","f0",0,"o0",0,0]],[["node_data","o1","\\"red\\""],["node_data","o1",{}]]]')

        self.graph.graph_change(cmds)
        self.graph.execute_node("o0")

