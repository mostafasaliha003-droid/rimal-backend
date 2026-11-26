import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import DeskApp from './DeskApp';
import './desk.css';

createRoot(document.getElementById('desk')).render(<StrictMode><DeskApp /></StrictMode>);
