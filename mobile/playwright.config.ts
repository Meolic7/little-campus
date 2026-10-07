import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests',timeout:45000,use:{baseURL:'http://127.0.0.1:5174',viewport:{width:390,height:844},locale:'zh-CN',browserName:'chromium',channel:'msedge'},webServer:{command:'npm run dev',url:'http://127.0.0.1:5174',reuseExistingServer:true},reporter:'list'});
