import { test } from 'vitest';

test('realms', () => {
  const ctrlSignal = new AbortController().signal;
  const reqSignal = new Request('http://localhost/').signal;

  console.log('AbortController signal is jsdom :', ctrlSignal instanceof EventTarget);
  console.log('Request signal is jsdom         :', reqSignal instanceof EventTarget);
  console.log(
    'same class                      :',
    ctrlSignal.constructor === reqSignal.constructor,
  );
  console.log(
    'Request ctor name               :',
    Request.name,
    '| src has [native code]:',
    String(Request).includes('native code'),
  );
});
