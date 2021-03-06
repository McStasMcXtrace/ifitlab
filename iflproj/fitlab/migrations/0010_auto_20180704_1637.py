# Generated by Django 2.0.1 on 2018-07-04 16:37

from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('fitlab', '0009_graphuirequest_username'),
    ]

    operations = [
        migrations.AddField(
            model_name='graphsession',
            name='created',
            field=models.DateTimeField(default=django.utils.timezone.now, verbose_name='created'),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='quicksave_graphdef',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='quicksave_matfile',
            field=models.CharField(default='', max_length=200),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='quicksave_pickle',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='quicksaved',
            field=models.DateTimeField(blank=True, null=True, verbose_name='quicksaved'),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='stashed',
            field=models.DateTimeField(blank=True, null=True, verbose_name='stashed'),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='stashed_graphdef',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='stashed_matfile',
            field=models.CharField(default='', max_length=200),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='stashed_pickle',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='graphsession',
            name='stashed_undostack',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='graphuirequest',
            name='cmd',
            field=models.CharField(default='update_run', max_length=200),
        ),
    ]
