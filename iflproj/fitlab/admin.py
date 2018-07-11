from django.contrib import admin
from .models import GraphUiRequest, GraphReply, GraphSession

admin.site.register(GraphUiRequest)
admin.site.register(GraphReply)
admin.site.register(GraphSession)
