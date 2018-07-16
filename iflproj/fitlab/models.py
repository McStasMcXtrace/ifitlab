from django.db import models
from django.db.models import TextField, CharField, DateTimeField, BooleanField
from django.utils import timezone


class GraphUiRequest(models.Model):
    created = DateTimeField('created', default=timezone.now)
    username = CharField(max_length=200)
    gs_id = CharField(max_length=200)
    cmd = CharField(max_length=200, default="update_run")
    syncset = TextField(blank=True, null=True)

class GraphReply(models.Model):
    created = DateTimeField('created', default=timezone.now)
    reqid = CharField(max_length=200, unique=True)
    reply_json = TextField()
    reply_error = TextField(blank=True, null=True)

class GraphSession(models.Model):
    created = DateTimeField('created', default=timezone.now)
    title = CharField(max_length=200, default="", blank=True, null=True)
    description = TextField(blank=True, null=True)
    example = BooleanField(default=False)
    
    username = CharField(max_length=200)
    quicksaved = DateTimeField('quicksaved', blank=True, null=True)
    stashed = DateTimeField('stashed', blank=True, null=True)

    # stashed live data on top of quicksave
    stashed_graphdef = TextField(blank=True)
    stashed_pickle = TextField(blank=True)
    stashed_matfile = CharField(max_length=200, default="")

    # restore point / quick save
    quicksave_graphdef = TextField(blank=True)
    quicksave_pickle = TextField(blank=True)
    quicksave_matfile = CharField(max_length=200, default="")

