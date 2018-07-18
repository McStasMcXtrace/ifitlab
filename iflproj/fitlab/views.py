import time

from django.shortcuts import render, redirect
from django.http import HttpResponse
from django.contrib.auth import authenticate, logout
from django.contrib.auth import login as login_native
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from django.contrib.auth.models import User

import enginterface
import fitlab.models
from .models import GraphUiRequest, GraphReply
from fitlab.models import GraphSession
from iflproj.settings import UI_COORDS_UPDATE_INTERVAL_MS, AJAX_REQ_TIMEOUT_S

def index(req):
    if not req.user.is_authenticated:
        return redirect("/ifl/login")

    username = req.session["username"]

    objs = GraphSession.objects.filter(username=username)
    examples = GraphSession.objects.filter(username="admin", example=True)
    session_ids_titles = [[obj.id, obj.title] for obj in objs]
    example_ids_titles = [[obj.id, obj.title] for obj in examples]
    ctx = { "username" : username, "session_ids_titles" : session_ids_titles, "example_ids_titles" : example_ids_titles }

    return render(req, "fitlab/dashboard.html", context=ctx)

def login_debuguser(req):
    # DEBUG MODE: auto-login as admin
    username = 'admin'
    password = 'admin123'

    user = authenticate(username=username, password=password)
    login_native(req, user)
    req.session['username'] = username

    return redirect("/ifl/")

def signup(req):
    return render(req, "fitlab/signup.html")

def signup_submit(req):
    User.objects.create_user(username=req.POST["username"], email='', password=req.POST["password"])
    return redirect("/ifl/login")

def login(req):
    return render(req, "fitlab/login.html")

def login_submit(req):
    username = req.POST["username"]
    user = authenticate(username=username, password=req.POST["password"])
    login_native(req, user)
    req.session['username'] = username

    return redirect("/ifl/")

@login_required
def graph_session(req, gs_id):
    # TODO: here, we need to put an "attach" which can be a "load_attach" (we don't know which one at this level)

    if not fitlab.models.GraphSession.objects.filter(id=gs_id).exists():
        print("redirecting missing graph session to index...")
        return redirect(index)
    return render(req, "fitlab/main.html", context={ "gs_id" : gs_id, "update_interval" : UI_COORDS_UPDATE_INTERVAL_MS })

@login_required
def logout_user(req):
    username = req.session.get('username', None)
    logout(req)
    if not username:
        return redirect("/ifl/")

    cmd = "autosave_shutdown"
    syncset = None

    print('loging out user: %s' % username)
    logout(req)

    _command(username, "*", cmd, syncset)
    return HttpResponse("%s has been loged out, autosaving active sessions ... <a href='/ifl/login'>login</a> <a href='/ifl/login_debuguser'>login as debuguser</a>" % username)

@login_required
def new_session(req):
    username = req.session['username']
    cmd = "new"
    syncset = None

    print('creating new graph session for user: %s' % (username))

    _command(username, "", cmd, syncset)
    return redirect("index")

@login_required
def new_session_and_open(req):
    username = req.session['username']
    cmd = "new"
    syncset = None

    print('creating new graph session for user: %s' % (username))

    ans, err = _command(username, "", cmd, syncset)
    
    return redirect("/ifl/graphsession/%s" % ans)

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


#################
#    Utility    #
#################

def _command(username, gs_id, cmd, syncset, nowait=False):
    ''' blocking with timeout, waits for workers to execute and returns the reply or None if timed out. '''
    # file the request
    uireq = GraphUiRequest(username=username, gs_id=gs_id, cmd=cmd, syncset=syncset)
    uireq.save()
    
    if nowait:
        return

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
            raise Exception("more than one reply for single request")
        time.sleep(0.1)
        elapsed = time.time() - t

        # timeout
        if elapsed > AJAX_REQ_TIMEOUT_S and AJAX_REQ_TIMEOUT_S > 0:
            # clean up the request if it still exists
            lst = GraphUiRequest.objects.filter(id=uireq.id)
            if len(lst)==1:
                lst[0].delete()
            return None, None

def _reply(reply_json, error_json):
    if reply_json:
        if error_json != None:
            return HttpResponse(error_json)
        return HttpResponse(reply_json)
    else:
        return HttpResponse('{"timeout" : "session request timed out" }')

#######################
#    AJAx handlers    #
#######################

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
    syncset = req.POST

    print("ajax_save_session, user: %s, gs_id: %s, sync: %s" % (username, gs_id, syncset))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)

@login_required
def ajax_run_node(req, gs_id):
    username = req.session['username']
    cmd = "update_run"
    syncset = req.POST

    print('ajax_run_node for user: %s, gs_id: %s ...' % (username, gs_id))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)

@login_required
def ajax_update(req, gs_id):
    username = req.session['username']
    cmd = "update"
    syncset = req.POST

    print('ajax_update for user: %s, gs_id: %s ...' % (username, gs_id))

    _command(username, gs_id, cmd, syncset, nowait=True)
    return HttpResponse("update received")
    
@login_required
def ajax_revert_session(req, gs_id):
    username = req.session['username']
    cmd = "revert"
    syncset = None

    print('ajax_revert_session for user: %s, gs_id: %s ...' % (username, gs_id))

    rep, err = _command(username, gs_id, cmd, syncset)
    return _reply(rep, err)


