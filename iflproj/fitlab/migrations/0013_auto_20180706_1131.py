# Generated by Django 2.0.1 on 2018-07-06 11:31

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('fitlab', '0012_auto_20180705_1635'),
    ]

    operations = [
        migrations.AlterField(
            model_name='graphuirequest',
            name='syncset',
            field=models.TextField(blank=True, null=True),
        ),
    ]