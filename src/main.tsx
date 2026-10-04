import React from 'react';
import { createRoot } from 'react-dom/client';
import OfficeSwitcher from './OfficeSwitcher';
import './styles.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><OfficeSwitcher /></React.StrictMode>);
