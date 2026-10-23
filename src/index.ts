import { type Env } from './model.js';
import { handleRequest } from './http.js';
import { handleMcp } from './mcp.js';
import { PageStore } from './store.js';
export default {
  fetch(request:Request,env:Env):Promise<Response>{return handleRequest(request,env,handleMcp);},
  async scheduled(_controller:unknown,env:Env):Promise<void>{await new PageStore(env.DB).maintenance();}
};
