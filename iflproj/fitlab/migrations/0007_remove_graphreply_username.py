# Generated by Django 2.0.1 on 2018-06-28 17:04

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('fitlab', '0006_graphuirequest_gs_id'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='graphreply',
            name='username',
        ),
    ]
