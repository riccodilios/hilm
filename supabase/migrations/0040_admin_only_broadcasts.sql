-- Product emails can be sent to the admin only (a real send to yourself, not a "[Test]").
alter table private.email_broadcasts drop constraint if exists email_broadcasts_audience_check;
alter table private.email_broadcasts
  add constraint email_broadcasts_audience_check check (audience in ('all', 'en', 'ar', 'admin'));
