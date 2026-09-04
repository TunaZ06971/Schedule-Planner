# Third-Party Notices

This project includes small UI design adaptations from Berkeleytime:

- Source project: <https://github.com/asuc-octo/berkeleytime>
- License: MIT
- Upstream copyright: Copyright 2021 the University of California, Berkeley ASUC Office of the CTO

Adapted ideas and values include the course color palette, calendar grid proportions, spacing, and event-card visual treatment used in:

- `config/palette.js`
- `public/style.css`
- `public/app.js`
- `config/courses.js`

The full upstream MIT license text is available at <https://github.com/asuc-octo/berkeleytime/blob/main/LICENSE>.

Course pages, calendars, and assignment metadata are fetched from public course websites at runtime. They are not distributed as part of this project except for minimized parser fixtures under `test/fixtures/`, which are retained only to exercise scraper behavior.
