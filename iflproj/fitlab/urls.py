from django.urls import path
from django.conf.urls import url

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    url(r'^new/?$', views.new_session),
    url(r'^newopen/?$', views.new_session_and_open),
    url(r'^clone/(?P<gs_id>[\w0-9]+)/?$', views.clone_session),
    url(r'^delete/(?P<gs_id>[\w0-9]+)/?$', views.delete_session),
    url(r'^logout/?$', views.logout_user),
    url(r'^graphsession/(?P<gs_id>[\w0-9]+)/?$', views.graph_session),
    url('^ajax_run_node/(?P<gs_id>[\w0-9]+)/?$', views.ajax_run_node),
    url('^ajax_update/(?P<gs_id>[\w0-9]+)/?$', views.ajax_update),
    url('^ajax_save_session/(?P<gs_id>[\w0-9]+)/?$', views.ajax_save_session),
    url('^ajax_load_session/(?P<gs_id>[\w0-9]+)/?$', views.ajax_load_session),
    url('^ajax_revert_session/(?P<gs_id>[\w0-9]+)/?$', views.ajax_revert_session),
]