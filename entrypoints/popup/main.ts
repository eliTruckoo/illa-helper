import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import '../../assets/main.css';
import { i18n, initializeLocale } from '@/src/i18n';

const app = createApp(App);

// Use i18n
app.use(i18n);

// Initialize language settings
initializeLocale();

app.mount('#app');
