# Generated by Django 2.0.1 on 2018-06-28 17:05

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('fitlab', '0007_remove_graphreply_username'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='graphuirequest',
            name='username',
        ),
    ]
