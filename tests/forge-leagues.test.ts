import assert from 'node:assert/strict';
import test from 'node:test';

import { managerMessageHref } from '../src/utils/forge-leagues';

test('manager message link opens a new Hattrick message for the selected manager', () => {
  assert.equal(
    managerMessageHref(123456),
    'https://www.hattrick.org/goto.ashx?path=/MyHattrick/Inbox/?actionType=newMail&userId=123456',
  );
});
