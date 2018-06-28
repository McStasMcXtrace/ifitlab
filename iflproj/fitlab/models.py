from django.db import models
from django.db.models.fields import TextField, CharField
from django.db.models.fields.related import ForeignKey

class GraphDef(models.Model):
    username = CharField(max_length=200)
    gs_id = CharField(max_length=200)
    graphdef_json = TextField()

class GraphUiRequest(models.Model):
    username = CharField(max_length=200)
    gs_id = CharField(max_length=200)
    syncset = TextField(blank=True)

class GraphReply(models.Model):
    reqid = CharField(max_length=200, unique=True)
    reply_json = TextField()

class GraphSession(models.Model):
    username = CharField(max_length=200)
    
    autosave_gdid = None
    autosave_mlfile = None
    save_gdid = None
    save_mlfile = None
    
