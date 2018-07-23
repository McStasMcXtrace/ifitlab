from django.contrib import admin
from .models import GraphUiRequest, GraphReply, GraphSession, TabId

admin.site.register(GraphUiRequest)
admin.site.register(GraphReply)
admin.site.register(GraphSession)
admin.site.register(TabId)
