import time
import json
import base64

from django.shortcuts import render, redirect
from django.http import HttpResponse
from django.contrib.auth import authenticate, logout
from django.contrib.auth import login as login_native
from django.contrib.auth.decorators import login_required
from django.utils import timezone
from django.contrib.auth.models import User

import enginterface
from .models import GraphSession, GraphUiRequest, GraphReply, TabId
from iflproj.settings import UI_COORDS_UPDATE_INTERVAL_MS, AJAX_REQ_TIMEOUT_S

def index(req):
    if not req.user.is_authenticated:
        return redirect("/ifl/login")

    username = req.session.get("username", None)
    if not username:
        return redirect("/ifl/login")

    objs = GraphSession.objects.filter(username=username).order_by('listidx')
    examples = GraphSession.objects.filter(username="admin", example=True).order_by('listidx')

    session_ids_titles = [[obj.id, obj.title] for obj in objs]
    example_ids_titles_comments = [[obj.id, obj.title, obj.excomment] for obj in examples]
    ctx = { "username" : username, "session_ids_titles" : session_ids_titles, "example_ids_titles_comments" : example_ids_titles_comments, 'admin' : req.user.is_superuser }

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
    # check for open sessions with the same username and gs_id
    if not GraphSession.objects.filter(id=gs_id).exists():
        print("redirecting missing graph session to index...")
        return redirect(index)

    tab_id = _tabcreate(gs_id)
    ct = { "gs_id" : gs_id, "update_interval" : UI_COORDS_UPDATE_INTERVAL_MS, "tab_id" : tab_id }
    return render(req, "fitlab/main.html", context=ct)

@login_required
def logout_user(req):
    username = req.session.get('username', None)
    logout(req)
    if not username:
        return redirect("/ifl/")

    print('loging out user: %s' % username)
    logout(req)

    _command(req, "autosave_shutdown", validate=False, username=username)
    return HttpResponse("%s has been loged out, autosaving active sessions ... <a href='/ifl/login'>login</a> <a href='/ifl/login_debuguser'>login as debuguser</a>" % username)

@login_required
def new_session(req):
    username = req.session['username']
    print('creating new graph session for user: %s' % (username))

    _command(req, "new", validate=False)
    return redirect("index")

@login_required
def new_session_and_open(req):
    username = req.session['username']
    print('creating new graph session for user: %s' % (username))

    ans, err = _command(req, "new", validate=False)
    
    return redirect("/ifl/graphsession/%s" % ans)

@login_required
def clone_session(req, gs_id):
    username = req.session['username']
    print('cloning graph session for user: %s, gs_id: %s' % (username, gs_id))

    _command(req, "clone", validate=False, gs_id=gs_id)
    return redirect("index")

@login_required
def delete_session(req, gs_id):
    username = req.session['username']
    print('deleting graph session for user: %s, gs_id: %s' % (username, gs_id))

    _command(req, "delete", validate=False, gs_id=gs_id)
    return redirect("index")

@login_required
def ajax_dashboard_edt_title(req):
    syncset = req.POST.get("data_str", None)
    dbobj = None
    try:
        obj = json.loads(syncset)
        dbobj = GraphSession.objects.filter(id=obj['gs_id'])[0]
        dbobj.title=obj['title']
        dbobj.save()
    except Exception as e:
        return HttpResponse('{ "message" : "edit failed: %s" }' % str(e))
    return HttpResponse('{ "message" : "session_%s: title was edited" }' % dbobj.id)

@login_required
def ajax_dashboard_edt_excomment(req):
    syncset = req.POST.get("data_str", None)
    dbobj = None
    try:
        obj = json.loads(syncset)
        dbobj = GraphSession.objects.filter(id=obj['gs_id'])[0]
        dbobj.excomment=obj['excomment']
        dbobj.save()
    except Exception as e:
        return HttpResponse('{ "message" : "edit failed: %s" }' % str(e))
    return HttpResponse('{ "message" : "session_%s: excomment was edited" }' % dbobj.id)

############################
#    Utility / Privates    #
############################

def _tabvalidation(req):
    gs_id = req.POST.get("gs_id")
    tab_id = req.POST.get("tab_id")
    print("tab validate: %s, %s" % (gs_id, tab_id))
    # check for existence
    tablst = TabId.objects.filter(gs_id=gs_id, id=tab_id)
    if len(tablst) == 0:
        return False
    tab = tablst[0]
    # check for newer
    for other in TabId.objects.filter(gs_id=gs_id).exclude(id=tab_id):
        if other.created > tab.created:
            print("deleting tab, gs_id: %s, tab_id: %s" % (gs_id, tab.id))
            tab.delete()
            return False
    # positive match
    return True

def _tabcreate(gs_id):
    ntab = TabId()
    ntab.gs_id = gs_id
    ntab.save()
    print("tab create: %s, %s" % (gs_id, ntab.id))
    return ntab.id

def _tabtakeover(req):
    gs_id = req.POST.get("gs_id")
    tab_id = req.POST.get("tab_id")
    print("tab id takeover")
    # delete all tabs of this session
    for sometab in TabId.objects.filter(gs_id=gs_id).exclude(id=tab_id):
        print("takeover deleting tab, gs_id: %s, tab_id: %s" % (sometab.gs_id, sometab.id))
        sometab.delete()

def _command(req, cmd, nowait=False, validate=True, gs_id="", username=""):
    '''
    Ajax command funnel, blocking with timeout.

    Returns workers' (reply, None) to executed request object, or (None, None) if a timeout occurs.

    Validates all calls using gs_id, tab_id and the current db state.
    '''
    if validate and not _tabvalidation(req):
        print("command validation error")
        return None, '{"fatalerror" : "Session ownership was taken over by another window."}'

    username = req.session.get("username", username)
    gs_id = req.POST.get("gs_id", gs_id)
    tab_id = req.POST.get("tab_id", "")
    syncset = req.POST.get("data_str", None)

    print('ajax "%s" for user: %s, gs_id: %s, tab_id: %s' % (cmd, username, gs_id, tab_id))    

    # file the request
    uireq = GraphUiRequest(username=username, gs_id=gs_id, cmd=cmd, syncset=syncset)
    uireq.save()

    if nowait:
        print("command nowait")
        return None, None

    # poll db
    t = time.time()
    while True:
        lst = GraphReply.objects.filter(reqid=uireq.id)
        if len(lst) == 1:
            answer = lst[0].reply_json
            error = lst[0].reply_error
            lst[0].delete()
            # success
            print("command success")
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
            print("command timeout")
            return None, '{"timeout" : "session request timed out" }'

def _reply(reply_json_str, error_json_str):
    if error_json_str:
        return HttpResponse(error_json_str)
    return HttpResponse(reply_json_str)

###############################
#    graphUi AJAx handlers    #
###############################

@login_required
def ajax_load_session(req):
    rep, err = _command(req, "load")
    # transfer validation to this tab, if load call was successful
    if rep != None:
        _tabtakeover(req)
    return _reply(rep, err)

@login_required
def ajax_save_session(req):
    rep, err = _command(req, "save")
    return _reply(rep, err)

@login_required
def ajax_run_node(req):
    rep, err = _command(req, "update_run")
    return _reply(rep, err)

@login_required
def ajax_clear_data(req):
    rep, err = _command(req, "clear_data")
    return _reply(rep, err)

@login_required
def ajax_update(req):
    rep, err = _command(req, "update", nowait=True)
    # NOTE: both of rep and err will be None, since we used nowait=True
    rep = None
    err = None

    gs_id = req.POST["gs_id"]
    if not GraphSession.objects.filter(id=gs_id).exists():
        return _reply(None, '{"fatalerror" : "Session does not exist."}')

    return _reply('{"message" : "coords update received"}', None)

@login_required
def ajax_revert_session(req):
    rep, err = _command(req, "revert")
    return _reply(rep, err)

@login_required
def ajax_get_notes(req):
    dbobj = None
    try:
        if not _tabvalidation(req):
            raise Exception("tab validation failed")
        dbobj = GraphSession.objects.filter(id=req.POST["gs_id"])[0]
    except Exception as e:
        return HttpResponse('{ "message" : "could not get notes: %s" }' % str(e))

    # NOTE: Strings are already decoded utf-8 (or similar), encoded is a byte repr. of a string, 
    # OR a b64 byte encoding of a such. This byte array needs decoding into a "base64 encoded string".
    text = dbobj.description.replace('\r', '')
    encoded = base64.b64encode(text.encode('utf-8'))
    
    return HttpResponse('{"notes" : "%s"}' % encoded.decode('utf-8'))

@login_required
def ajax_edt_notes(req):
    dbobj = None
    try:
        if not _tabvalidation(req):
            raise Exception("tab validation failed")
        dbobj = GraphSession.objects.filter(id=req.POST["gs_id"])[0]
        dbobj.description = json.loads(req.POST.get("data_str", None))['notes']
        dbobj.save()
    except Exception as e:
        return HttpResponse('{ "message" : "edit failed: %s" }' % str(e))
    return HttpResponse('{ "message" : "session_%s: notes were edited" }' % dbobj.id)

