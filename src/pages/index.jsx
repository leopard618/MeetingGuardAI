import Layout from "./Layout.jsx";

import Dashboard from "./Dashboard";

import AIChat from "./AIChat";

import WhatsAppBot from "./WhatsAppBot";

import Calendar from "./Calendar";

import Settings from "./Settings";

import CreateMeeting from "./CreateMeeting";

import AIInsights from "./AIInsights";

import ChooseCreationMethod from "./ChooseCreationMethod";

import ApiSettings from "./Apisettings";

import Privacy from "./Privacy";

import Terms from "./Terms";

import Notes from "./Notes";

import { BrowserRouter as Router, Route, Routes, useLocation } from 'react-router-native';

const PAGES = {
    
    Dashboard: Dashboard,
    
    AIChat: AIChat,
    
    WhatsAppBot: WhatsAppBot,
    
    Calendar: Calendar,
    
    Settings: Settings,
    
    CreateMeeting: CreateMeeting,
    
    AIInsights: AIInsights,
    
    ChooseCreationMethod: ChooseCreationMethod,
    
    ApiSettings: ApiSettings,
    
    Privacy: Privacy,
    
    Terms: Terms,
    
    Notes: Notes,
    
}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    
    return (
        <Layout currentPageName={currentPage}>
            <Routes>            
                
                <Route path="/" element={<Dashboard />} />
                
                <Route path="/Dashboard" element={<Dashboard />} />
                
                <Route path="/AIChat" element={<AIChat />} />
                
                <Route path="/WhatsAppBot" element={<WhatsAppBot />} />
                
                <Route path="/Calendar" element={<Calendar />} />
                
                <Route path="/Settings" element={<Settings />} />
                
                <Route path="/CreateMeeting" element={<CreateMeeting />} />
                
                <Route path="/AIInsights" element={<AIInsights />} />
                
                <Route path="/ChooseCreationMethod" element={<ChooseCreationMethod />} />
                
                <Route path="/ApiSettings" element={<ApiSettings />} />
                
                <Route path="/Privacy" element={<Privacy />} />
                
                <Route path="/Terms" element={<Terms />} />
                
                <Route path="/Notes" element={<Notes />} />
                
            </Routes>
        </Layout>
    );
}

export default function Pages() {
    return (
        <Router>
            <PagesContent />
        </Router>
    );
}