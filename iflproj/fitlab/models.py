from django.db import models
from django.db.models.fields import TextField, CharField
from django.db.models.fields.related import ForeignKey

class GraphDef(models.Model):
    username = CharField(max_length=200, unique=True)
    graphdef_json = TextField()

class GraphUiRequest(models.Model):
    username = CharField(max_length=200, unique=True)
    syncset = TextField()

class GraphReply(models.Model):
    username = CharField(max_length=200, unique=True)
    reqid = CharField(max_length=200, unique=True)
    reply_json = TextField()
