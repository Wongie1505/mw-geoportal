// ========================================
// MALAWI GEOPORTAL
// DEMO LOGIN
// ========================================

const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");


// Demo accounts
// In the real system these will come from
// the backend/database.
const demoUsers = [
    {
        email: "public@geoportal.mw",
        password: "public123",
        role: "public"
    },

    {
        email: "department@geoportal.mw",
        password: "dept123",
        role: "department"
    },

    {
        email: "admin@geoportal.mw",
        password: "admin123",
        role: "admin"
    }
];


// Handle login
loginForm.addEventListener("submit", function(event) {

    event.preventDefault();

    const email =
        document.getElementById("email").value.trim().toLowerCase();

    const password =
        document.getElementById("password").value;


    // Find the account using email and password
    const user = demoUsers.find(function(account) {

        return (
            account.email === email &&
            account.password === password
        );

    });


    // Login successful
    if (user) {

        // Save the authenticated user
        localStorage.setItem(
            "geoportalUser",
            JSON.stringify(user)
        );

        loginMessage.textContent =
            "Login successful. Redirecting...";

        loginMessage.className =
            "login-message success";


        // Redirect to dashboard
        setTimeout(function() {

            window.location.href = "dashboard.html";

        }, 1000);


    } else {

        // Login failed
        loginMessage.textContent =
            "Invalid email or password.";

        loginMessage.className =
            "login-message error";

    }

});