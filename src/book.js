import { mount } from 'svelte';
import './app.css';
import BookingApp from './BookingApp.svelte';

mount(BookingApp, { target: document.getElementById('book-app') });
