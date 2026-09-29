import {defineConfig} from 'vite';
export default defineConfig({root:'apps/web',base:'./',build:{outDir:'../../web-dist',emptyOutDir:true},server:{host:'127.0.0.1'}});
