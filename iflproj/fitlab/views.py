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

GS_REQ_TIMEOUT = 30

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
    
    # file the request
    syncset = request.POST.get('json_str')
    uireq = GraphUiRequest(username=request.session['username'], gs_id=gs_id, syncset=syncset)
    uireq.save()
    reqid = uireq.id

    # wait for reply or time out
    reply_json = _poll_db_for_reply(reqid)
    if reply_json:
        return HttpResponse(reply_json)
    else:
        return HttpResponse('{"error" : { "message" : "graph session request timed out" }}')

def _poll_db_for_reply(requid, timeout=GS_REQ_TIMEOUT):
    ''' polling the db is used as a process sync mechanism '''
    t = time.time()
    while True:
        lst = GraphReply.objects.filter(reqid=requid)
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


