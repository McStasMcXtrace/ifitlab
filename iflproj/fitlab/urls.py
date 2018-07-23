from django.urls import path
from django.conf.urls import url

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    url(r'^new/?$', views.new_session),
    url(r'^signup/?$', views.signup),
    url(r'^signup_submit/?$', views.signup_submit),
    url(r'^login/?$', views.login),
    url(r'^login_submit/?$', views.login_submit),
    url(r'^login_debuguser/?$', views.login_debuguser),
    url(r'^newopen/?$', views.new_session_and_open),
    url(r'^clone/(?P<gs_id>[\w0-9]+)/?$', views.clone_session),
    url(r'^delete/(?P<gs_id>[\w0-9]+)/?$', views.delete_session),
    url(r'^logout/?$', views.logout_user),
    url(r'^graphsession/(?P<gs_id>[\w0-9]+)/?$', views.graph_session),
    url('^ajax_run_node/?$', views.ajax_run_node),
    url('^ajax_update/?$', views.ajax_update),
    url('^ajax_save_session/?$', views.ajax_save_session),
    url('^ajax_load_session/?$', views.ajax_load_session),
    url('^ajax_revert_session/?$', views.ajax_revert_session),
]
