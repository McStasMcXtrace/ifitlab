from django.urls import path

from . import views

urlpatterns = [
    path('', views.index, name='index'),
    path('ajax_run_node', views.ajax_run_node, name='ajax_run_node'),
    path('ajax_save_graph_def', views.ajax_save_graph_def, name='ajax_save_graph_def'),
    path('ajax_load_graph_def', views.ajax_load_graph_def, name='ajax_load_graph_def'),
]