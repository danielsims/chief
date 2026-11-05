//! One host, separately enrolled machine and channel-agent roles.
use chief_machine::{agent, machine};

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "agent") {
        if let Err(error) = agent::cli(&args[1..]).await {
            eprintln!("chief-machine: {error}");
            std::process::exit(1);
        }
    } else if args.first().is_some_and(|arg| arg == "serve") {
        if let Err(error) = agent::serve_host().await {
            eprintln!("chief-machine: {error}");
            std::process::exit(1);
        }
    } else if args.first().is_some_and(|arg| arg == "browser") {
        if let Err(error) = chief_machine::browser::cli(&args[1..]).await {
            eprintln!("chief-machine: {error}");
            std::process::exit(1);
        }
    } else {
        if args.is_empty() || args[0] == "--help" || args[0] == "-h" {
            println!("One Chief host: channel agents and optional workspace browser capacity.\n\nAgent commands: chief-machine agent --help\nBrowser commands: chief-machine browser --help\nMachine enrollment and fetch commands:");
        }
        machine::run(args).await;
    }
}
