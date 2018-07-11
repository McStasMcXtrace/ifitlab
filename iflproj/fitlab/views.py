from django.shortcuts import render, redirect
from django.http import HttpResponse
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.decorators import login_required
from django.utils import timezone

from .models import GraphUiRequest, GraphReply

import time

import enginterface
import fitlab.models
from fitlab.models import GraphSession

GS_REQ_TIMEOUT = 30

def index(req):
    # TEMP auto-login as admin
    username = 'admin'
    password = 'admin123'

    user = authenticate(username=username, password=password)
    login(req, user)
    req.session['username'] = username
    
    # get graph session ids
    session_ids = [obj.id for obj in GraphSession.objects.filter(username=username)]
    
    return render(req, "fitlab/dashboard.html", context={ "session_ids" : session_ids })
    return HttpResponse("logged in as admin... <br><a href='/ifl/graphsession/1'>open hardcoded gs</a>")

@login_required
def graph_session(req, gs_id):
    # TODO: here, we need to put an "attach" which can be a "load_attach" (we don't know which one at this level)

    if not fitlab.models.GraphSession.objects.filter(id=gs_id).exists():
        print("redirecting missing graph session to index...")
        return redirect(index)
    return render(req, "fitlab/main.html", context={ "gs_id" : gs_id })

@login_required
def logout_user(req):
    username = req.session['username']
    cmd = "autosave_shutdown"
    syncset = None

    print('loging out user: %s' % username)
    logout(req)

    _command(username, "*", cmd, syncset)
    return HttpResponse("%s has been loged out, autosaving active sessions ... <a href='/ifl'>login</a>" % username)

@login_required
def new_session(req):
    username = req.session['username']
    cmd = "new"
    syncset = None

    print('creating new graph session for user: %s' % (username))

    _command(username, "", cmd, syncset)
    return redirect("index")

@login_required
def clone_session(req, gs_id):
    username = req.session['username']
    cmd = "clone"
    syncset = None

    print('cloning graph session for user: %s, gs_id: %s' % (username, gs_id))

    _command(username, gs_id, cmd, syncset)
    return redirect("index")

@login_required
def delete_session(req, gs_id):
    username = req.session['username']
    cmd = "delete"
    syncset = None

    print('deleting graph session for user: %s, gs_id: %s' % (username, gs_id))

    _command(username, gs_id, cmd, syncset)
    return redirect("index")


############################
#    AJAx call handlers    #
############################

def _command(username, gs_id, cmd, syncset):
    ''' blocking with timeout, waits for workers to execute and returns the reply or None if timed out. '''
    # file the request
    uireq = GraphUiRequest(username=username, gs_id=gs_id, cmd=cmd, syncset=syncset)
    uireq.save()

    # poll db
    t = time.time()
    while True:
        lst = GraphReply.objects.filter(reqid=uireq.id)
        if len(lst) == 1:
            answer = lst[0].reply_json
            error = lst[0].reply_error
            lst[0].delete()
            # success
            return answer, error
        if len(lst) > 1:
            raise Exception("more than one reply for single request - multi-processing issue detected")
        time.sleep(0.1)
        elapsed = time.time() - t

        # timeout
        if elapsed > GS_REQ_TIMEOUT and GS_REQ_TIMEOUT > 0:
            return None

def _reply(reply_json, error_json):
    if reply_json:
        if error_json != None:
            return HttpResponse(error_json)
        return HttpResponse(reply_json)
    else:
        return HttpResponse('{"error" : { "message" : "graph session request timed out" }}')

@login_required
def ajax_load_session(req, gs_id):
    username = req.session['username']
    cmd = "load"
    syncset = None

    print('ajax_load_session for user: %s, gs_id: %s ...' % (username, gs_id))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)

@login_required
def ajax_save_session(req, gs_id):
    username = req.session['username']
    cmd = "save"
    syncset = req.POST.get('sync')

    print("ajax_save_session, user: %s, gs_id: %s, sync: %s" % (username, gs_id, str(syncset)))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)

@login_required
def ajax_run_node(req, gs_id):
    username = req.session['username']
    cmd = "update_run"
    syncset = req.POST.get('json_str')

    print('ajax_run_node for user: %s, gs_id: %s ...' % (username, gs_id))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)

@login_required
def ajax_update(req, gs_id):
    username = req.session['username']
    cmd = "update"
    syncset = req.POST.get('json_str')

    print('ajax_update for user: %s, gs_id: %s ...' % (username, gs_id))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)

@login_required
def ajax_revert_session(req, gs_id):
    username = req.session['username']
    cmd = "revert"
    syncset = None

    print('ajax_revert_session for user: %s, gs_id: %s ...' % (username, gs_id))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)


