from django.shortcuts import render
from django.http import HttpResponse
from django.contrib.auth import authenticate, login, logout

import json
import re
import importlib

import engintf
from fitlab.models import GraphDef

def index(request):
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

    return render(request, "fitlab/main.html")

def ajax_run_node(request):
    ''' ajax target function for "run node" action '''
    s = request.POST.get('json_str')
    if not s:
        return HttpResponse("ajax request FAIL");
    print("received command: %s" % s)

    # get the command data
    obj = json.loads(s)
    runid = obj['run_id']
    syncset = obj['sync']

    # pass it on
    username = request.session['username']
    graphsession = get_graph_session(username)
    json_obj = graphsession.update_and_execute(runid, syncset)

    # return the data
    return HttpResponse(json.dumps(json_obj))

def ajax_load_graph_def(request):
    ''' can we load a graph def from the db? '''
    username = request.session['username']
    gd = GraphDef.objects.filter(username__exact=username)
    graphdef_json = gd[0].graphdef_json
    print('loading graph def for user %s: %s chars' % (username, len(graphdef_json)))
    return HttpResponse(graphdef_json)

def ajax_save_graph_def(request):
    ''' can we save a graph def to the db? '''
    s = request.POST.get('graphdef')

    username = request.session['username']
    existing = GraphDef.objects.filter(username__exact=username)
    existing.delete()
    gd = GraphDef(graphdef_json=s, username=username)
    gd.save()

    return HttpResponse("graphdef saved")


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
        text = self._loadNodeTypesJsFile()
        tree = engintf.TreeJsonAddr(json.loads(text))

        text = open('pmodule.json').read()
        pmod = json.loads(text)
        mdl = importlib.import_module(pmod["module"], pmod["package"])
        self.graph = engintf.FlatGraph(tree, mdl)

    def test(self):
        cmds = json.loads('[[["node_add",454.25,401.3333333333333,"o0","","","obj"],["node_rm","o0"]],[["node_add",382.75,281.3333333333333,"o1","","","Pars"],["node_rm","o1"]],[["node_add",348,367.3333333333333,"f0","","C","Colour"],["node_rm","f0"]],[["link_add","o1",0,"f0",0,0],["link_rm","o1",0,"f0",0,0]],[["link_add","f0",0,"o0",0,0],["link_rm","f0",0,"o0",0,0]],[["node_data","o1","\\"red\\""],["node_data","o1",{}]]]')

        self.graph.graph_change(cmds)
        self.graph.execute_node("o0")
