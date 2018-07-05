from django.urls import path
from django.conf.urls import url

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    url(r'^graphsession/(?P<gs_id>[\w0-9]+)/?$', views.graph_session, name='graph_session'),
    url('^ajax_run_node/(?P<gs_id>[\w0-9]+)/?$', views.ajax_run_node, name='ajax_run_node'),
    url('^ajax_save_session/(?P<gs_id>[\w0-9]+)/?$', views.ajax_save_session, name='ajax_save_graph_def'),
    url('^ajax_load_session/(?P<gs_id>[\w0-9]+)/?$', views.ajax_load_session, name='ajax_load_graph_def'),
]