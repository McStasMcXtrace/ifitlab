from django.urls import path
from django.conf.urls import url

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    url(r'^signup/?$', views.signup),
    url(r'^signup_submit/?$', views.signup_submit),
    url(r'^login/?$', views.login),
    url(r'^login_submit/?$', views.login_submit),
    url(r'^login_debuguser/?$', views.login_debuguser),
    url(r'^logout/?$', views.logout_user),

    url(r'^new/?$', views.new_session),
    url(r'^newopen/?$', views.new_session_and_open),
    url(r'^cloneopen/(?P<gs_id>[\w0-9]+)/?$', views.clone_session_and_open),
    url(r'^clone/(?P<gs_id>[\w0-9]+)/?$', views.clone_session),
    url(r'^delete/(?P<gs_id>[\w0-9]+)/?$', views.delete_session),
    url(r'^reset/(?P<gs_id>[\w0-9]+)/?$', views.reset_session),
    url(r'^cmdlog/(?P<gs_id>[\w0-9]+)/?$', views.extractlogfrom_session),

    url('^ajax_dashboard_edt_title/?$', views.ajax_dashboard_edt_title),
    url('^ajax_dashboard_edt_excomment/?$', views.ajax_dashboard_edt_excomment),

    url(r'^graphsession/(?P<gs_id>[\w0-9]+)/?$', views.graph_session),

    url('^ajax_run_node/?$', views.ajax_run_node),
    url('^ajax_clear_data/?$', views.ajax_clear_data),
    url('^ajax_update/?$', views.ajax_update),
    url('^ajax_save_session/?$', views.ajax_save_session),
    url('^ajax_load_session/?$', views.ajax_load_session),
    url('^ajax_revert_session/?$', views.ajax_revert_session),

    url('^ajax_get_notes/?$', views.ajax_get_notes),
    url('^ajax_edt_notes/?$', views.ajax_edt_notes),

]
