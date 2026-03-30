/**
 * MSW server instance for the counter module.
 */

import { setupServer } from 'msw/native';
import { handlers } from './handlers';

export const server = setupServer(...handlers);
