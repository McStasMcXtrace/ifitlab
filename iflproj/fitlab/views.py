from django.shortcuts import render, redirect
from django.http import HttpResponse
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required

from .models import GraphUiRequest, GraphReply

import json
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

    login(request, user)
    print("default user was logged in")

    request.session['username'] = username

    return render(request, "fitlab/main.html", context={ "gs_id" : "hest" })

@login_required
def graph_session(request, gs_id):
    # TODO: here, we need to put an "attach" which can be a "load_attach" (we don't know which one at this level)

    if not fitlab.models.GraphSession.objects.filter(id=gs_id).exists():
        print("redirecting missing graph session to index...")
        return redirect(index)
    return render(request, "fitlab/main.html", context={ "gs_id" : gs_id })

@login_required
def ajax_run_node(request, gs_id):
    s = request.POST.get('json_str')
    if not s:
        return HttpResponse("ajax request FAIL");

    username = request.session['username']
    cmd = "update_run"
    syncset = request.POST.get('json_str')

    return _reply(_command(username, gs_id, cmd, syncset))

def _reply(reply_json):
    '''
    standard reply 
    '''
    if reply_json:
        return HttpResponse(reply_json)
    else:
        return HttpResponse('{"error" : { "message" : "graph session request timed out" }}')

def _command(username, gs_id, cmd, syncset):
    '''
    blocking with timeout, waits for workers to execute and returns the reply or None if timed out
    '''
    # file the request
    uireq = GraphUiRequest(username=username, gs_id=gs_id, cmd=cmd, syncset=syncset)
    uireq.save()

    # poll db
    t = time.time()
    while True:
        lst = GraphReply.objects.filter(reqid=uireq.id)
        if len(lst) == 1:
            answer = lst[0].reply_json
            lst[0].delete()
            # success
            return answer
        if len(lst) > 1:
            raise Exception("more than one reply for single request - multi-processing issue detected")
        time.sleep(0.1)
        elapsed = time.time() - t
        if elapsed > GS_REQ_TIMEOUT and GS_REQ_TIMEOUT > 0:
            # timeout
            return None

@login_required
def ajax_load_session(request, gs_id):
    username = request.session['username']
    cmd = "load"
    syncset = None

    print('loading session %s for user %s ...' % (gs_id, username))

    return _reply(_command(username, gs_id, cmd, syncset))

@login_required
def ajax_save_session(request, gs_id):
    s = request.POST.get('graphdef')

    username = request.session['username']
    print("ajax_save_session has not been implemented, user: %s, gs_id: %s" % (username, gs_id))

    '''
    existing = GraphDef.objects.filter(username__exact=username)
    existing.delete()
    gd = GraphDef(graphdef_json=s, username=username, gs_id=gs_id)
    gd.save()
    '''

    return HttpResponse("session saved: not implemented")


