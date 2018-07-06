from django.db import models
from django.db.models import TextField, CharField, DateTimeField, BinaryField
from django.utils import timezone


class GraphDef(models.Model):
    username = CharField(max_length=200)
    gs_id = CharField(max_length=200)
    graphdef_json = TextField()

class GraphUiRequest(models.Model):
    username = CharField(max_length=200)
    gs_id = CharField(max_length=200)
    cmd = CharField(max_length=200, default="update_run")
    syncset = TextField(blank=True, null=True)

class GraphReply(models.Model):
    reqid = CharField(max_length=200, unique=True)
    reply_json = TextField()

class GraphSession(models.Model):
    username = CharField(max_length=200)
    created = DateTimeField('created', default=timezone.now)
    quicksaved = DateTimeField('quicksaved', blank=True, null=True)
    stashed = DateTimeField('stashed', blank=True, null=True)

    # stashed live data on top of quicksave
    stashed_graphdef = TextField(blank=True)
    stashed_pickle = TextField(blank=True)
    stashed_matfile = CharField(max_length=200, default="")

    stashed_undostack = TextField(blank=True) # this is mainly for transferring the undo stack from a previous browser as a gimmick

    # restore point / quick save
    quicksave_graphdef = TextField(blank=True)
    quicksave_pickle = TextField(blank=True)
    quicksave_matfile = CharField(max_length=200, default="")
