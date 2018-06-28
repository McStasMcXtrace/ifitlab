from django.contrib import admin
from .models import GraphDef, GraphUiRequest, GraphReply, GraphSession

admin.site.register(GraphDef)
admin.site.register(GraphUiRequest)
admin.site.register(GraphReply)
admin.site.register(GraphSession)
