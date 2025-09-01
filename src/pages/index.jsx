import Layout from "./Layout.jsx";

import Auth from "./Auth";

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

import GoogleCalendarTest from "./GoogleCalendarTest";
import CalendarTestPage from "./CalendarTestPage";

import { BrowserRouter as Router, Route, Routes, useLocation, Navigate } from 'react-router-native';
import { useAuth } from '@/contexts/AuthContext.web';

const PAGES = {
    
    Auth: Auth,
    
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
    
    GoogleCalendarTest: GoogleCalendarTest,
    CalendarTest: CalendarTestPage,

}

function _getCurrentPage(url) {
    if (url.endsWith('/')) {
        url = url.slice(0, -1);
    }
    let urlLastPart = url.split('/').pop();
    if (urlLastPart.includes('?')) {
        urlLastPart = urlLastPart.split('?')[0];
    }

    // Handle root path for Auth page
    if (url === '' || url === '/') {
        return 'Auth';
    }

    const pageName = Object.keys(PAGES).find(page => page.toLowerCase() === urlLastPart.toLowerCase());
    return pageName || Object.keys(PAGES)[0];
}

// Protected Route component
function ProtectedRoute({ children }) {
    const { isAuthenticated, isLoading } = useAuth();
    
    if (isLoading) {
        return <div>Loading...</div>; // You can replace this with a proper loading component
    }
    
    if (!isAuthenticated) {
        return <Navigate to="/" replace />;
    }
    
    return children;
}

// Create a wrapper component that uses useLocation inside the Router context
function PagesContent() {
    const location = useLocation();
    const currentPage = _getCurrentPage(location.pathname);
    const { isAuthenticated } = useAuth();
    
    // Check if current page is Auth (no layout needed)
    const isAuthPage = currentPage === 'Auth' || location.pathname === '/';
    
    // If user is authenticated and trying to access auth page, redirect to dashboard
    if (isAuthPage && isAuthenticated) {
        return <Navigate to="/Dashboard" replace />;
    }
    
    if (isAuthPage) {
        return (
            <Routes>
                <Route path="/" element={<Auth />} />
                <Route path="/Auth" element={<Auth />} />
            </Routes>
        );
    }
    
    return (
        <Layout currentPageName={currentPage}>
            <Routes>
                <Route path="/Dashboard" element={
                    <ProtectedRoute>
                        <Dashboard />
                    </ProtectedRoute>
                } />
                <Route path="/AIChat" element={
                    <ProtectedRoute>
                        <AIChat />
                    </ProtectedRoute>
                } />
                <Route path="/WhatsAppBot" element={
                    <ProtectedRoute>
                        <WhatsAppBot />
                    </ProtectedRoute>
                } />
                <Route path="/Calendar" element={
                    <ProtectedRoute>
                        <Calendar />
                    </ProtectedRoute>
                } />
                <Route path="/Settings" element={
                    <ProtectedRoute>
                        <Settings />
                    </ProtectedRoute>
                } />
                <Route path="/CreateMeeting" element={
                    <ProtectedRoute>
                        <CreateMeeting />
                    </ProtectedRoute>
                } />
                <Route path="/AIInsights" element={
                    <ProtectedRoute>
                        <AIInsights />
                    </ProtectedRoute>
                } />
                <Route path="/ChooseCreationMethod" element={
                    <ProtectedRoute>
                        <ChooseCreationMethod />
                    </ProtectedRoute>
                } />
                <Route path="/ApiSettings" element={
                    <ProtectedRoute>
                        <ApiSettings />
                    </ProtectedRoute>
                } />
                <Route path="/Privacy" element={
                    <ProtectedRoute>
                        <Privacy />
                    </ProtectedRoute>
                } />
                <Route path="/Terms" element={
                    <ProtectedRoute>
                        <Terms />
                    </ProtectedRoute>
                } />
                <Route path="/Notes" element={
                    <ProtectedRoute>
                        <Notes />
                    </ProtectedRoute>
                } />

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