/**
 * Default MSW handlers for the counter module.
 */

import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('/api/data', () => {
    return HttpResponse.json({ value: 42 });
  }),
];
