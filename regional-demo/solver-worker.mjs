import {solve} from './optimizer.mjs';
self.onmessage=e=>{try{const {config,hubs,goals}=e.data;const result=solve(config,hubs,goals,n=>{if(n%12===0)self.postMessage({progress:n})});self.postMessage({result})}catch(error){self.postMessage({error:error.message})}};
