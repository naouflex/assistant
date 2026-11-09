import { register } from "node:module";

register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function resolve(s,c,n){try{return await n(s,c)}catch(e){if(s.endsWith(".js"))return n(s.slice(0,-3)+".ts",c);throw e}}',
    ),
);
