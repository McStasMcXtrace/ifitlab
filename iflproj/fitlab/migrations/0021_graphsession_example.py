# Generated by Django 2.0.1 on 2018-07-16 17:12

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fitlab', '0020_auto_20180712_1236'),
    ]

    operations = [
        migrations.AddField(
            model_name='graphsession',
            name='example',
            field=models.BooleanField(default=False),
        ),
    ]