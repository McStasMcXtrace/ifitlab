from django.db import models
from django.db.models.fields import TextField, CharField

# Create your models here.
class GraphDef(models.Model):
    graphdef_json = TextField()
    username = CharField(max_length=200, unique=True)
