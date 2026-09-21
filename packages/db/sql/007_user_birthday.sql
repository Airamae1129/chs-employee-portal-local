-- Employee birthdays: managed by Admin (Holiday Calendars > Employee Birthdays)
-- and shown to every role on the Timekeeping & Calendar page.
ALTER TABLE "User" ADD COLUMN "birthday" DATE;
