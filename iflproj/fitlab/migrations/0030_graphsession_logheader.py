# Generated by Django 2.0.1 on 2018-08-23 13:49

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fitlab', '0029_auto_20180823_0920'),
    ]

    operations = [
        migrations.AddField(
            model_name='graphsession',
            name='logheader',
            field=models.TextField(blank=True, null=True),
        ),
    ]
