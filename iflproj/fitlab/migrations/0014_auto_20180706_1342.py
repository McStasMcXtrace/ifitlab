# Generated by Django 2.0.1 on 2018-07-06 13:42

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fitlab', '0013_auto_20180706_1131'),
    ]

    operations = [
        migrations.AlterField(
            model_name='graphsession',
            name='quicksave_pickle',
            field=models.BinaryField(blank=True),
        ),
        migrations.AlterField(
            model_name='graphsession',
            name='stashed_pickle',
            field=models.BinaryField(blank=True),
        ),
    ]
