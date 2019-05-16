from django.db import models
from django.db.models import TextField, CharField, DateTimeField, BooleanField, IntegerField
from django.utils import timezone

class TabId(models.Model):
    created = DateTimeField('created', default=timezone.now)
    gs_id = CharField(max_length=200)

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

    listidx = IntegerField(default=0)
    title = CharField(max_length=200, default="", blank=True, null=True)
    description = TextField(blank=True, null=True)
    loglines = TextField(blank=True, null=True)
    logheader = TextField(blank=True, null=True)

    example = BooleanField(default=False)
    excomment = CharField(max_length=200, default="", blank=True, null=True)

    username = CharField(max_length=200)
    quicksaved = DateTimeField('quicksaved', blank=True, null=True)
    stashed = DateTimeField('stashed', blank=True, null=True)

    graphdef = TextField(blank=True)

    # stashed live data on top of quicksave
    stashed_pickle = TextField(blank=True)
    stashed_matfile = CharField(max_length=200, default="", blank=True)

    # restore point / quick save
    quicksave_pickle = TextField(blank=True)
    quicksave_matfile = CharField(max_length=200, default="", blank=True)

    def __str__(self):
       return 'session %s, idx %s, %s' % (self.id, self.listidx, self.title)
    def reset(self):
        self.stashed_pickle = "reset"
        self.quicksave_pickle = "reset"
        self.loglines = ""
        self.logheader = ""
        self.stashed_matfile = ""
        self.quicksave_matfile = ""
